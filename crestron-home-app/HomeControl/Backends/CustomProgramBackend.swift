import Foundation

/// For dealer-programmed (SIMPL) systems: connects as a touch panel over CIP and
/// translates joins to and from the app's model using a `JoinMap`.
@MainActor
final class CustomProgramBackend: HomeBackend {
    var onChange: ((HomeSnapshot) -> Void)?
    var onStatusChange: ((BackendStatus) -> Void)?
    let pollInterval: Duration? = nil

    private let host: String
    private let map: JoinMap
    private let client: CIPClient
    private var digital: [Int: Bool] = [:]
    private var analog: [Int: Int] = [:]
    private var serial: [Int: String] = [:]
    /// Doorbell index -> when its ring join last went high.
    private var ringAt: [Int: Date] = [:]
    private var publishScheduled = false
    private var hasConnected = false

    init(host: String, ipId: UInt8, port: UInt16, map: JoinMap) {
        let cleanHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        self.host = cleanHost
        self.map = map
        client = CIPClient(host: cleanHost, port: port, ipId: ipId)
        client.onDigital = { [weak self] join, value in
            guard let self else { return }
            self.digital[join] = value
            if value {
                for (i, bell) in self.map.doorbells.enumerated() where bell.ring == join { self.ringAt[i] = Date() }
            }
            self.schedulePublish()
        }
        client.onSerial = { [weak self] join, text in
            self?.serial[join] = text
            self?.schedulePublish()
        }
        client.onAnalog = { [weak self] join, value in
            self?.analog[join] = value
            self?.schedulePublish()
        }
        client.onStateChange = { [weak self] state in
            guard let self, self.hasConnected else { return }
            switch state {
            case .connected: self.onStatusChange?(.connected)
            case let .failed(reason): self.onStatusChange?(.reconnecting(reason))
            default: break
            }
        }
    }

    func connect() async throws {
        guard !host.isEmpty else { throw BackendError.notConfigured(L("Enter the processor address in Settings.")) }
        client.start()
        let deadline = Date().addingTimeInterval(12)
        while Date() < deadline {
            if client.state == .connected {
                hasConnected = true
                return
            }
            if client.registrationRejected, case let .failed(reason) = client.state {
                throw BackendError.connection(reason)
            }
            try await Task.sleep(for: .milliseconds(200))
        }
        let reason: String
        if case let .failed(message) = client.state {
            reason = message
        } else {
            reason = L("No answer from {host} on the touch-panel port. Check the address and IP ID.", ["host": host])
        }
        client.stop()
        throw BackendError.connection(reason)
    }

    func disconnect() {
        client.stop()
    }

    func fetch() async throws -> HomeSnapshot { snapshot() }

    // MARK: Joins -> model

    private func schedulePublish() {
        // A burst of joins arrives at once (e.g. the initial update); publish once.
        guard !publishScheduled else { return }
        publishScheduled = true
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(60))
            guard let self else { return }
            self.publishScheduled = false
            self.onChange?(self.snapshot())
        }
    }

    private func isHigh(_ join: Int?) -> Bool { join.map { digital[$0] ?? false } ?? false }
    private func level(_ join: Int?) -> Double? { join.map { Double(analog[$0] ?? 0) / 65535 } }
    private func text(_ join: Int?) -> String {
        join.map { (serial[$0] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
    }

    private func snapshot() -> HomeSnapshot {
        var home = HomeSnapshot()
        home.rooms = map.rooms.map { Room(id: $0.id, name: $0.name, floor: $0.floor) }

        home.lights = map.lights.indices.map { i -> Light in
            let e = map.lights[i]
            let dimmed = level(e.level)
            return Light(
                id: "light-\(i)", name: e.name, roomId: e.room,
                level: dimmed ?? (isHigh(e.onFeedback ?? e.on) ? 1 : 0),
                isDimmable: e.level != nil
            )
        }

        home.shades = map.shades.indices.map { i -> Shade in
            let e = map.shades[i]
            return Shade(
                id: "shade-\(i)", name: e.name, roomId: e.room,
                position: level(e.position) ?? 0.5,
                supportsPosition: e.position != nil,
                supportsStop: e.stop != nil
            )
        }

        home.scenes = map.scenes.indices.map { i -> HomeScene in
            let e = map.scenes[i]
            return HomeScene(id: "scene-\(i)", name: e.name, roomId: e.room, kind: .other,
                      isActive: isHigh(e.feedback ?? e.press))
        }

        home.media = map.media.indices.map { i -> MediaZone in
            let e = map.media[i]
            let sources = (e.sources ?? []).indices.map { si in MediaSource(id: "src-\(si)", name: e.sources?[si].name ?? "") }
            let current = (e.sources ?? []).enumerated().first { isHigh($0.element.feedback ?? $0.element.press) }
            // Optional transport buttons and song-name text joins.
            let title = text(e.title)
            return MediaZone(
                id: "media-\(i)", name: e.name, roomId: e.room,
                isOn: isHigh(e.powerFeedback ?? e.powerOn),
                volume: level(e.volume) ?? 0,
                isMuted: isHigh(e.muteFeedback ?? e.mute),
                hasVolume: e.volume != nil,
                sources: sources,
                currentSourceId: current.map { "src-\($0.offset)" },
                isPlaying: isHigh(e.playingFeedback ?? e.powerFeedback ?? e.powerOn),
                canTransport: e.play != nil || e.pause != nil || e.next != nil || e.previous != nil,
                nowPlaying: title.isEmpty ? nil : NowPlaying(title: title, artist: text(e.artist), album: text(e.album))
            )
        }

        home.locks = map.locks.indices.map { i -> DoorLock in
            let e = map.locks[i]
            return DoorLock(id: "lock-\(i)", name: e.name, roomId: e.room,
                     isLocked: e.lockedFeedback.map { digital[$0] ?? false })
        }

        home.security = map.security.indices.map { i -> SecurityPanel in
            let e = map.security[i]
            let mode: SecurityMode
            if isHigh(e.alarmFeedback) {
                mode = .alarm
            } else if isHigh(e.armedAwayFeedback) {
                mode = .armedAway
            } else if isHigh(e.armedHomeFeedback) {
                mode = .armedHome
            } else if isHigh(e.disarmedFeedback) {
                mode = .disarmed
            } else if e.toggle != nil && e.armedAwayFeedback != nil {
                // A zone with one toggle button and one "armed" light: low means off.
                mode = .disarmed
            } else {
                mode = .unknown
            }
            return SecurityPanel(id: "security-\(i)", name: e.name, mode: mode, needsCode: e.code != nil,
                                 canArmHome: e.armHome != nil, canArmAway: e.armAway != nil || e.toggle != nil)
        }

        home.gates = map.gates.indices.map { i -> Gate in
            let e = map.gates[i]
            let state: GateState
            if isHigh(e.openFeedback) {
                state = .open
            } else if isHigh(e.closedFeedback) {
                state = .closed
            } else {
                state = (e.openFeedback != nil && e.closedFeedback != nil) ? .moving : .unknown
            }
            return Gate(id: "gate-\(i)", name: e.name, state: state,
                        hasSeparateOpenClose: e.open != nil && e.close != nil, canStop: e.stop != nil)
        }

        home.doorbells = map.doorbells.indices.map { i -> Doorbell in
            let e = map.doorbells[i]
            let lockIndex = map.locks.firstIndex { $0.name == e.lock }
            return Doorbell(id: "doorbell-\(i)", name: e.name, cameraName: e.camera,
                            lockId: lockIndex.map { "lock-\($0)" }, ringAt: ringAt[i])
        }

        home.climate = map.climate.indices.map { i -> Climate in
            let e = map.climate[i]
            return Climate(id: "climate-\(i)", name: e.name, roomId: e.room,
                           current: temperature(e.current, scale: e.scale), target: temperature(e.target, scale: e.scale),
                           minimum: e.min ?? 5, maximum: e.max ?? 30, step: e.step ?? 0.5,
                           heating: e.heating.map { digital[$0] ?? false })
        }

        home.modes = map.modes.indices.map { i -> HomeMode in
            let e = map.modes[i]
            let options = e.options.indices.map { oi -> ModeOption in
                let o = e.options[oi]
                return ModeOption(id: o.optionId(oi), name: o.name ?? o.id ?? String(oi + 1))
            }
            return HomeMode(id: "mode-\(i)", name: e.name, kind: e.kind ?? "other", value: modeValue(e), options: options)
        }

        home.switches = map.switches.indices.map { i -> HomeSwitch in
            let e = map.switches[i]
            return HomeSwitch(id: "switch-\(i)", name: e.name, roomId: e.room, kind: e.kind ?? "other",
                              isOn: isHigh(e.feedback ?? e.on ?? e.toggle), current: temperature(e.temperature, scale: e.scale))
        }
        return home
    }

    /// Temperatures arrive as whole numbers: °C × scale (10 by default, so 215 = 21.5 °C).
    /// Analog joins are unsigned 16-bit; values above 32767 are negative temperatures.
    private func temperature(_ join: Int?, scale: Double?) -> Double? {
        guard let join, let raw = analog[join] else { return nil }
        let signed = raw > 32767 ? raw - 65536 : raw
        let divisor = Self.scale(scale)
        return (Double(signed) / divisor * 10).rounded() / 10
    }

    private static func scale(_ value: Double?) -> Double {
        guard let value, value.isFinite, value != 0 else { return 10 }
        return value
    }

    /// The first option whose analog value matches, or whose feedback is high.
    private func modeValue(_ e: JoinMap.ModeEntry) -> String? {
        let hit: Int?
        if let join = e.analog, let raw = analog[join] {
            hit = e.options.indices.first { e.options[$0].value == Double(raw) }
        } else {
            hit = e.options.indices.first { isHigh(e.options[$0].feedback ?? e.options[$0].press) }
        }
        return hit.map { e.options[$0].optionId($0) }
    }

    // MARK: Model -> joins

    func perform(_ command: HomeCommand) async throws {
        guard client.state == .connected else {
            throw BackendError.connection(L("Not connected to the processor yet."))
        }
        switch command {
        case let .setLight(id, value):
            let e = try entry(map.lights, id)
            if let join = e.level {
                client.setAnalog(join, Int((value.clamped01 * 65535).rounded()))
            } else if let on = e.on {
                // With only an "on" join the button is a toggle.
                let wantOn = value > 0
                if let off = e.off { client.pulse(wantOn ? on : off) }
                else if wantOn != isHigh(e.onFeedback ?? on) { client.pulse(on) }
            }
        case let .setShade(id, position):
            let e = try entry(map.shades, id)
            if let join = e.position {
                client.setAnalog(join, Int((position.clamped01 * 65535).rounded()))
            } else if let join = position >= 0.5 ? e.open : e.close {
                client.pulse(join)
            }
        case let .stopShade(id):
            let e = try entry(map.shades, id)
            guard let join = e.stop else { throw BackendError.notSupported(L("Stopping this shade")) }
            client.pulse(join)
        case let .recallScene(id):
            let e = try entry(map.scenes, id)
            client.pulse(e.press)
        case let .mediaPower(id, on):
            let e = try entry(map.media, id)
            guard let join = on ? e.powerOn : (e.powerOff ?? e.powerOn) else { throw BackendError.notSupported(L("Media power")) }
            client.pulse(join)
        case let .mediaVolume(id, value):
            let e = try entry(map.media, id)
            guard let join = e.volume else { throw BackendError.notSupported(L("Volume")) }
            client.setAnalog(join, Int((value.clamped01 * 65535).rounded()))
        case let .mediaMute(id, muted):
            let e = try entry(map.media, id)
            guard let join = e.mute else { throw BackendError.notSupported(L("Mute")) }
            if muted != isHigh(e.muteFeedback ?? join) { client.pulse(join) }
        case let .mediaSource(id, sourceId):
            let e = try entry(map.media, id)
            let sources = e.sources ?? []
            guard let i = index(sourceId), sources.indices.contains(i) else { throw BackendError.badResponse(L("Unknown source")) }
            client.pulse(sources[i].press)
        case let .mediaTransport(id, action):
            let e = try entry(map.media, id)
            // A single play/pause button is common: use it for both when only one is mapped.
            let join: Int?
            switch action {
            case .play: join = e.play ?? e.pause
            case .pause: join = e.pause ?? e.play
            case .next: join = e.next
            case .previous: join = e.previous
            }
            guard let join else { throw BackendError.notSupported(L("That music button")) }
            client.pulse(join)
        case let .setLock(id, locked):
            let e = try entry(map.locks, id)
            client.pulse(locked ? e.lock : e.unlock)
        case let .setSecurity(id, mode, code):
            let e = try entry(map.security, id)
            if let join = e.code, let code { client.setSerial(join, code) }
            let target: Int?
            switch mode {
            case .armedAway: target = e.armAway
            case .armedHome: target = e.armHome
            case .disarmed: target = e.disarm
            case .alarm, .unknown: target = nil
            }
            if let target {
                client.pulse(target)
            } else if let toggle = e.toggle {
                // One button that arms and disarms: press it only when the state has to change.
                let armed = isHigh(e.armedAwayFeedback) || isHigh(e.armedHomeFeedback)
                if armed != (mode != .disarmed) { client.pulse(toggle) }
            } else {
                throw BackendError.notSupported(L("That security mode"))
            }
        case let .gate(id, action):
            let e = try entry(map.gates, id)
            let join: Int?
            switch action {
            case .open: join = e.open ?? e.trigger
            case .close: join = e.close ?? e.trigger
            case .stop: join = e.stop
            case .trigger: join = e.trigger ?? e.open
            }
            guard let join else { throw BackendError.notSupported(L("That gate action")) }
            client.pulse(join)
        case let .setClimate(id, value):
            let e = try entry(map.climate, id)
            let scale = Self.scale(e.scale)
            let step = (e.step ?? 0.5) > 0 ? (e.step ?? 0.5) : 0.5
            let low = e.min ?? 5, high = e.max ?? 30
            let target = Swift.min(high, Swift.max(low, (value / step).rounded() * step))
            if let join = e.target, e.targetWritable != false {
                // Signed 16-bit on the wire: negative values wrap to 65536 + value.
                let scaled = Swift.min(32767, Swift.max(-32768, (target * scale).rounded()))
                let raw = scaled.isFinite ? Int(scaled) : 0
                client.setAnalog(join, raw < 0 ? raw + 65536 : raw)
                return
            }
            // Only up/down buttons: press one of them once per step.
            guard let now = temperature(e.target, scale: e.scale), let up = e.up, let down = e.down else {
                throw BackendError.notSupported(L("Setting this thermostat"))
            }
            let steps = Swift.min(50, (abs(target - now) / step).rounded())
            let presses = steps.isFinite ? Int(steps) : 0
            for _ in 0..<Swift.max(0, presses) {
                client.pulse(target > now ? up : down)
                // A press is 200 ms; leave a gap so the program sees separate presses.
                try await Task.sleep(for: .milliseconds(400))
            }
        case let .setMode(id, value):
            let e = try entry(map.modes, id)
            guard let optionIndex = e.options.indices.first(where: { e.options[$0].optionId($0) == value }) else {
                throw BackendError.badResponse(L("Unknown option."))
            }
            let option = e.options[optionIndex]
            if let join = e.analog, let number = option.value, number.isFinite {
                client.setAnalog(join, Int(Swift.min(65535, Swift.max(0, number)).rounded()))
            } else if let press = option.press {
                client.pulse(press)
            } else {
                throw BackendError.notSupported(L("That option"))
            }
        case let .setSwitch(id, on):
            let e = try entry(map.switches, id)
            if on, let join = e.on {
                client.pulse(join)
            } else if !on, let join = e.off {
                client.pulse(join)
            } else if let toggle = e.toggle ?? (e.off == nil ? e.on : nil) {
                // One button: press it only when the state has to change.
                if on != isHigh(e.feedback ?? e.on ?? e.toggle) { client.pulse(toggle) }
            } else {
                throw BackendError.notSupported(L("This switch"))
            }
        case .tvKey, .tvApp, .mediaChannel:
            throw BackendError.notSupported(L("The TV remote"))
        }
    }

    /// Ids look like "light-3": the number is the entry's position in the join map.
    private func index(_ id: String) -> Int? {
        id.split(separator: "-").last.flatMap { Int($0) }
    }

    private func entry<T>(_ list: [T], _ id: String) throws -> T {
        guard let i = index(id), list.indices.contains(i) else {
            throw BackendError.badResponse(L("“{id}” isn't in the join map.", ["id": id]))
        }
        return list[i]
    }
}
