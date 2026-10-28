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
    private var publishScheduled = false
    private var hasConnected = false

    init(host: String, ipId: UInt8, port: UInt16, map: JoinMap) {
        let cleanHost = host.trimmingCharacters(in: .whitespacesAndNewlines)
        self.host = cleanHost
        self.map = map
        client = CIPClient(host: cleanHost, port: port, ipId: ipId)
        client.onDigital = { [weak self] join, value in
            self?.digital[join] = value
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
        guard !host.isEmpty else { throw BackendError.notConfigured("Enter the processor address in Settings.") }
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
            reason = "No answer from \(host) on the touch-panel port. Check the address and IP ID."
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

    private func snapshot() -> HomeSnapshot {
        var home = HomeSnapshot()
        home.rooms = map.rooms.map { Room(id: $0.id, name: $0.name) }

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
            return MediaZone(
                id: "media-\(i)", name: e.name, roomId: e.room,
                isOn: isHigh(e.powerFeedback ?? e.powerOn),
                volume: level(e.volume) ?? 0,
                isMuted: isHigh(e.muteFeedback ?? e.mute),
                hasVolume: e.volume != nil,
                sources: sources,
                currentSourceId: current.map { "src-\($0.offset)" }
            )
        }

        home.locks = map.locks.indices.map { i -> DoorLock in
            let e = map.locks[i]
            return DoorLock(id: "lock-\(i)", name: e.name, roomId: e.room,
                     isLocked: e.lockedFeedback.map { digital[$0] ?? false })
        }

        home.security = map.security.indices.map { i -> SecurityPanel in
            let e = map.security[i]
            let mode: SecurityMode =
                isHigh(e.alarmFeedback) ? .alarm :
                isHigh(e.armedAwayFeedback) ? .armedAway :
                isHigh(e.armedHomeFeedback) ? .armedHome :
                isHigh(e.disarmedFeedback) ? .disarmed : .unknown
            return SecurityPanel(id: "security-\(i)", name: e.name, mode: mode,
                                 needsCode: e.code != nil, canArmHome: e.armHome != nil, canArmAway: e.armAway != nil)
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
        return home
    }

    // MARK: Model -> joins

    func perform(_ command: HomeCommand) async throws {
        guard client.state == .connected else {
            throw BackendError.connection("Not connected to the processor yet.")
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
            guard let join = e.stop else { throw BackendError.notSupported("Stopping this shade") }
            client.pulse(join)
        case let .recallScene(id):
            let e = try entry(map.scenes, id)
            client.pulse(e.press)
        case let .mediaPower(id, on):
            let e = try entry(map.media, id)
            guard let join = on ? e.powerOn : (e.powerOff ?? e.powerOn) else { throw BackendError.notSupported("Media power") }
            client.pulse(join)
        case let .mediaVolume(id, value):
            let e = try entry(map.media, id)
            guard let join = e.volume else { throw BackendError.notSupported("Volume") }
            client.setAnalog(join, Int((value.clamped01 * 65535).rounded()))
        case let .mediaMute(id, muted):
            let e = try entry(map.media, id)
            guard let join = e.mute else { throw BackendError.notSupported("Mute") }
            if muted != isHigh(e.muteFeedback ?? join) { client.pulse(join) }
        case let .mediaSource(id, sourceId):
            let e = try entry(map.media, id)
            let sources = e.sources ?? []
            guard let i = index(sourceId), sources.indices.contains(i) else { throw BackendError.badResponse("Unknown source") }
            client.pulse(sources[i].press)
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
            guard let target else { throw BackendError.notSupported("That security mode") }
            client.pulse(target)
        case let .gate(id, action):
            let e = try entry(map.gates, id)
            let join: Int?
            switch action {
            case .open: join = e.open ?? e.trigger
            case .close: join = e.close ?? e.trigger
            case .stop: join = e.stop
            case .trigger: join = e.trigger ?? e.open
            }
            guard let join else { throw BackendError.notSupported("That gate action") }
            client.pulse(join)
        }
    }

    /// Ids look like "light-3": the number is the entry's position in the join map.
    private func index(_ id: String) -> Int? {
        id.split(separator: "-").last.flatMap { Int($0) }
    }

    private func entry<T>(_ list: [T], _ id: String) throws -> T {
        guard let i = index(id), list.indices.contains(i) else {
            throw BackendError.badResponse("“\(id)” isn't in the join map.")
        }
        return list[i]
    }
}
