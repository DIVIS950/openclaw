import Foundation

/// Samsung TVs as media zones, each driven by its own `SamsungTVClient`. A TV can't report
/// its input, channel or volume, so the zone shows what was last sent from here, plus the
/// on/standby state read every 10 seconds.
@MainActor
final class SamsungTVSource: HomeBackend {
    static let sourceName = "samsungtv"
    static let idPrefix = "stv:"
    static let origin = "samsungtv"

    var onChange: ((HomeSnapshot) -> Void)?
    var onStatusChange: ((BackendStatus) -> Void)?
    let pollInterval: Duration? = .seconds(10)
    /// Every TV's pairing state in words, by address, for Settings.
    var onTVStatus: (([String: String]) -> Void)?

    /// Inputs every TV has, in the order they're shown.
    static let inputs: [(id: String, name: String, key: String)] = [
        ("hdmi1", "HDMI 1", "KEY_HDMI1"), ("hdmi2", "HDMI 2", "KEY_HDMI2"),
        ("hdmi3", "HDMI 3", "KEY_HDMI3"), ("hdmi4", "HDMI 4", "KEY_HDMI4"), ("tv", "TV", "KEY_TV"),
    ]

    /// Apps most TVs have, by their Tizen ids; installed ones the TV lists are added to these.
    static let knownApps: [MediaApp] = [
        MediaApp(id: "11101200001", name: "Netflix"), MediaApp(id: "111299001912", name: "YouTube"),
        MediaApp(id: "3201512006785", name: "Prime Video"), MediaApp(id: "3201901017640", name: "Disney+"),
        MediaApp(id: "3201606009684", name: "Spotify"), MediaApp(id: "3201807016597", name: "Apple TV"),
        MediaApp(id: "3201601007230", name: "Max"),
    ]

    /// What this app last told the TV, since the TV doesn't say.
    private struct LocalState {
        var sourceId: String?
        var channel: Channel?
        var app: MediaApp?
        var muted = false
        var playing = true
    }

    private let configs: [SamsungTVConfig]
    private var clients: [String: SamsungTVClient] = [:]
    private var local: [String: LocalState] = [:]

    init(tvs: [SamsungTVConfig]) {
        // Hosts are trimmed once here; `clients` and `local` are keyed by the trimmed host.
        configs = tvs.compactMap { tv in
            var clean = tv
            clean.host = tv.host.trimmingCharacters(in: .whitespacesAndNewlines)
            return clean.host.isEmpty ? nil : clean
        }
        for tv in configs {
            let client = SamsungTVClient(host: tv.host, mac: tv.mac, token: tv.token)
            client.onChange = { [weak self] in self?.publish() }
            // The token arrives once the person taps Allow on the TV; keep it for next time.
            client.onToken = { token in tv.token = token }
            clients[client.host] = client
        }
    }

    func connect() async throws {
        guard !clients.isEmpty else { throw BackendError.notConfigured(L("Add a Samsung TV in Settings.")) }
        for client in clients.values { client.start() }
    }

    func disconnect() {
        for client in clients.values { client.stop() }
    }

    /// Reads on/standby from every TV (2 s each, together), then the zones.
    func fetch() async throws -> HomeSnapshot {
        let all = Array(clients.values)
        await withTaskGroup(of: Void.self) { group in
            for client in all {
                group.addTask { await client.refreshPower() }
            }
        }
        publishStatus()
        return snapshot()
    }

    /// Opens the socket again for one TV so it shows its Allow prompt (Settings › Pair).
    func pair(host: String) {
        clients[host]?.pair()
    }

    // MARK: TVs -> model

    private func publish() {
        publishStatus()
        onChange?(snapshot())
    }

    private func publishStatus() {
        var status: [String: String] = [:]
        for (host, client) in clients { status[host] = client.statusText }
        onTVStatus?(status)
        if clients.values.contains(where: { $0.state == .connected }) {
            onStatusChange?(.connected)
        } else if let waiting = clients.values.first(where: { $0.state == .waitingForAllow }) {
            onStatusChange?(.reconnecting(L("Allow Home Control on the TV screen") + " (\(waiting.host))"))
        } else if let first = configs.first.flatMap({ clients[$0.host] }) {
            onStatusChange?(.reconnecting(first.statusText))
        }
    }

    private func snapshot() -> HomeSnapshot {
        var home = HomeSnapshot()
        for tv in configs {
            guard let client = clients[tv.host] else { continue }
            let state = local[tv.host] ?? LocalState()
            let on = client.powerOn == true || (client.powerOn == nil && client.state == .connected)
            let name = tv.name.trimmingCharacters(in: .whitespaces)
            var apps = Self.knownApps
            for app in client.installedApps where !apps.contains(where: { $0.id == app.id }) { apps.append(app) }
            home.media.append(MediaZone(
                id: Self.idPrefix + tv.host, name: name.isEmpty ? (client.deviceName ?? "Samsung TV") : name, roomId: tv.roomId,
                isOn: on, volume: 0, isMuted: state.muted, hasVolume: false,
                sources: Self.inputs.map { MediaSource(id: $0.id, name: $0.name) },
                currentSourceId: on ? state.sourceId : nil, isPlaying: on && state.playing, canTransport: true,
                nowPlaying: on ? state.app.map { NowPlaying(title: $0.name, artist: "App", album: name) } : nil,
                kind: "tv", canRemote: true, apps: apps, channel: on ? state.channel : nil, origin: Self.origin
            ))
        }
        return home
    }

    // MARK: Model -> TV

    func perform(_ command: HomeCommand) async throws {
        let host = String(command.deviceId.dropFirst(Self.idPrefix.count))
        guard command.deviceId.hasPrefix(Self.idPrefix), let client = clients[host] else {
            throw BackendError.badResponse(L("This device isn't in the system anymore."))
        }
        var state = local[host] ?? LocalState()
        defer {
            local[host] = state
            publish()
        }
        switch command {
        case let .mediaPower(_, on):
            if on {
                guard client.powerOn != true else { return }
                // Standby: wake-on-LAN brings it up; a TV that still answers takes the power key too.
                client.wake()
                if client.state == .connected { try await client.send(key: "KEY_POWER") }
                if client.mac.isEmpty && client.state != .connected {
                    throw BackendError.notSupported(L("Turning on this TV without its MAC address"))
                }
            } else if client.powerOn != false {
                try await client.send(key: "KEY_POWER")
            }
        case .mediaVolume:
            throw BackendError.notSupported(L("Setting the volume level on this TV"))
        case let .mediaMute(_, muted):
            try await client.send(key: "KEY_MUTE")
            state.muted = muted
        case let .mediaSource(_, sourceId):
            guard let input = Self.inputs.first(where: { $0.id == sourceId }) else { throw BackendError.badResponse(L("Unknown source")) }
            try await client.send(key: input.key)
            state.sourceId = sourceId
            state.app = nil
            if sourceId != "tv" { state.channel = nil }
        case let .mediaTransport(_, action):
            let key: String
            switch action {
            case .play: key = "KEY_PLAY"
            case .pause: key = "KEY_PAUSE"
            case .next: key = "KEY_FF"
            case .previous: key = "KEY_REWIND"
            }
            try await client.send(key: key)
            if action == .play { state.playing = true }
            if action == .pause { state.playing = false }
        case let .tvKey(_, key):
            try await client.send(key: Self.keyName(key))
            switch key {
            case .mute: state.muted.toggle()
            case .play: state.playing = true
            case .pause, .stop: state.playing = false
            case .chUp, .chDown:
                let current = state.channel?.number ?? 1
                state.channel = Channel(number: max(1, current + (key == .chUp ? 1 : -1)), name: "")
                state.sourceId = "tv"
                state.app = nil
            default: break
            }
        case let .tvApp(_, appId):
            try await client.launchApp(appId)
            state.app = (Self.knownApps + client.installedApps).first { $0.id == appId } ?? MediaApp(id: appId, name: appId)
            state.sourceId = nil
            state.channel = nil
            state.playing = true
        case let .mediaChannel(_, number):
            // The digits one by one, then Enter, like typing them on the remote.
            for digit in String(max(1, number)) {
                try await client.send(key: "KEY_\(digit)")
                try await Task.sleep(for: .milliseconds(150))
            }
            try await client.send(key: "KEY_ENTER")
            state.channel = Channel(number: max(1, number), name: "")
            state.sourceId = "tv"
            state.app = nil
        case .setLight, .setShade, .stopShade, .recallScene, .setLock, .setSecurity, .gate, .setClimate, .setMode, .setSwitch:
            throw BackendError.notSupported(L("That on a TV"))
        }
    }

    /// TV_KEYS -> the TV's key names.
    static func keyName(_ key: TVKey) -> String {
        switch key {
        case .up: return "KEY_UP"
        case .down: return "KEY_DOWN"
        case .left: return "KEY_LEFT"
        case .right: return "KEY_RIGHT"
        case .ok: return "KEY_ENTER"
        case .back: return "KEY_RETURN"
        case .home: return "KEY_HOME"
        case .menu: return "KEY_MENU"
        case .exit: return "KEY_EXIT"
        case .info: return "KEY_INFO"
        case .guide: return "KEY_GUIDE"
        case .chUp: return "KEY_CHUP"
        case .chDown: return "KEY_CHDOWN"
        case .volUp: return "KEY_VOLUP"
        case .volDown: return "KEY_VOLDOWN"
        case .mute: return "KEY_MUTE"
        case .power: return "KEY_POWER"
        case .play: return "KEY_PLAY"
        case .pause: return "KEY_PAUSE"
        case .stop: return "KEY_STOP"
        case .rewind: return "KEY_REWIND"
        case .fastForward: return "KEY_FF"
        case .num0: return "KEY_0"
        case .num1: return "KEY_1"
        case .num2: return "KEY_2"
        case .num3: return "KEY_3"
        case .num4: return "KEY_4"
        case .num5: return "KEY_5"
        case .num6: return "KEY_6"
        case .num7: return "KEY_7"
        case .num8: return "KEY_8"
        case .num9: return "KEY_9"
        case .red: return "KEY_RED"
        case .green: return "KEY_GREEN"
        case .yellow: return "KEY_YELLOW"
        case .blue: return "KEY_BLUE"
        }
    }
}
