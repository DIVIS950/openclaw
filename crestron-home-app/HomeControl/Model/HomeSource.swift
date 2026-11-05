import Foundation

/// One system the store talks to: the main one (demo, Crestron Home or the custom program)
/// or an extra one (Apple Home, Samsung TVs). Each keeps its own connection state and its
/// own part of the house; `HomeStore` merges them into one home and routes commands back
/// by device id. An extra source that fails never touches the main one.
@MainActor
final class HomeSource {
    /// "main", "homekit" or "samsungtv" (the key in `HomeStore.extraStatus`).
    let name: String
    let backend: HomeBackend
    let isMain: Bool
    /// Device ids this source owns start with this ("hk:", "stv:"). The main source owns the rest.
    let idPrefix: String?
    private(set) var snapshot = HomeSnapshot()
    private(set) var connection: HomeStore.Connection = .idle
    private var loopTask: Task<Void, Never>?

    init(name: String, backend: HomeBackend, isMain: Bool, idPrefix: String?) {
        self.name = name
        self.backend = backend
        self.isMain = isMain
        self.idPrefix = idPrefix
    }

    func owns(id: String) -> Bool {
        guard let idPrefix else { return true }
        return id.hasPrefix(idPrefix)
    }

    /// Connects, fetches, and keeps polling when the backend wants it. `onUpdate` runs on
    /// the main actor after every change of the snapshot or the connection state.
    func start(onUpdate: @escaping @MainActor () -> Void) {
        backend.onChange = { [weak self] snapshot in
            self?.snapshot = snapshot
            onUpdate()
        }
        backend.onStatusChange = { [weak self] status in
            switch status {
            case .connected: self?.connection = .connected
            case let .reconnecting(reason): self?.connection = .failed(reason)
            }
            onUpdate()
        }
        connection = .connecting
        let backend = self.backend
        loopTask = Task { [weak self] in
            var connected = false
            while !Task.isCancelled {
                do {
                    if !connected {
                        try await backend.connect()
                        connected = true
                    }
                    let snapshot = try await backend.fetch()
                    guard !Task.isCancelled, let self else { return }
                    self.snapshot = snapshot
                    self.connection = .connected
                    onUpdate()
                } catch {
                    guard !Task.isCancelled, let self else { return }
                    self.connection = .failed(error.localizedDescription)
                    onUpdate()
                }
                // Push backends only need polling until the first connect succeeds.
                guard let wait = backend.pollInterval ?? (connected ? nil : .seconds(5)) else { return }
                try? await Task.sleep(for: wait)
            }
        }
    }

    func stop() {
        loopTask?.cancel()
        loopTask = nil
        backend.onChange = nil
        backend.onStatusChange = nil
        backend.disconnect()
        snapshot = HomeSnapshot()
        connection = .idle
    }
}

extension HomeSnapshot {
    /// Adds another system's rooms and devices to this one. A room with the same name as one
    /// already here (an Apple Home "Obývák" next to the Crestron "Obývák") is the same room,
    /// so its devices show up side by side instead of in a second room.
    mutating func merge(_ other: HomeSnapshot) {
        var roomMap: [String: String] = [:]
        for room in other.rooms {
            if let same = rooms.first(where: { Self.sameName($0.name, room.name) }) {
                roomMap[room.id] = same.id
            } else if !rooms.contains(where: { $0.id == room.id }) {
                rooms.append(room)
            }
        }
        let remap = { (id: String?) -> String? in id.map { roomMap[$0] ?? $0 } }
        for var light in other.lights { light.roomId = remap(light.roomId); lights.append(light) }
        for var shade in other.shades { shade.roomId = remap(shade.roomId); shades.append(shade) }
        for var scene in other.scenes { scene.roomId = remap(scene.roomId); scenes.append(scene) }
        for var zone in other.media { zone.roomId = remap(zone.roomId); media.append(zone) }
        for var lock in other.locks { lock.roomId = remap(lock.roomId); locks.append(lock) }
        for var sensor in other.sensors { sensor.roomId = remap(sensor.roomId); sensors.append(sensor) }
        for var thermostat in other.climate { thermostat.roomId = remap(thermostat.roomId); climate.append(thermostat) }
        for var item in other.switches { item.roomId = remap(item.roomId); switches.append(item) }
        security += other.security
        gates += other.gates
        doorbells += other.doorbells
        modes += other.modes
    }

    private static func sameName(_ a: String, _ b: String) -> Bool {
        let x = a.trimmingCharacters(in: .whitespacesAndNewlines)
        let y = b.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !x.isEmpty, !y.isEmpty else { return false }
        return x.compare(y, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }
}
