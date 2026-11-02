import Foundation
import Observation

/// The single source of truth the views read. Owns the active backend, keeps the
/// snapshot fresh (polling or push), and applies commands optimistically.
@MainActor
@Observable
final class HomeStore {
    enum Connection: Equatable {
        case idle, connecting, connected
        case failed(String)
    }

    private(set) var home = HomeSnapshot()
    private(set) var connection: Connection = .idle
    private(set) var mode: ConnectionMode = .demo
    /// Short-lived message for a command that didn't go through.
    private(set) var commandError: String?
    /// Last time the user touched a control (drives the wall-panel screensaver).
    private(set) var lastUserAction = Date()
    /// Goes up when something needs the screen awake (the doorbell); RootView hides StandBy.
    private(set) var wakeRequests = 0

    @ObservationIgnored private var backend: HomeBackend?
    @ObservationIgnored private var loopTask: Task<Void, Never>?
    @ObservationIgnored private var errorTask: Task<Void, Never>?
    @ObservationIgnored private var recent: [String: (command: HomeCommand, at: Date)] = [:]
    /// Brightness each light had before it was turned off, so tapping it back on restores it.
    @ObservationIgnored private var lastLevels: [String: Double] = [:]

    func connect(using settings: AppSettings) {
        disconnect()
        mode = settings.mode
        let backend: HomeBackend
        do {
            backend = try settings.makeBackend()
        } catch {
            connection = .failed(error.localizedDescription)
            return
        }
        self.backend = backend
        connection = .connecting
        backend.onChange = { [weak self] snapshot in self?.receive(snapshot) }
        backend.onStatusChange = { [weak self] status in
            switch status {
            case .connected: self?.connection = .connected
            case let .reconnecting(reason): self?.connection = .failed(reason)
            }
        }

        loopTask = Task { [weak self] in
            var connected = false
            while !Task.isCancelled {
                do {
                    if !connected {
                        try await backend.connect()
                        connected = true
                    }
                    let snapshot = try await backend.fetch()
                    guard !Task.isCancelled else { return }
                    self?.receive(snapshot)
                    self?.connection = .connected
                } catch {
                    guard !Task.isCancelled else { return }
                    self?.connection = .failed(error.localizedDescription)
                }
                // Push backends only need polling until the first connect succeeds.
                guard let wait = backend.pollInterval ?? (connected ? nil : .seconds(5)) else { return }
                try? await Task.sleep(for: wait)
            }
        }
    }

    func disconnect() {
        loopTask?.cancel()
        loopTask = nil
        backend?.onChange = nil
        backend?.onStatusChange = nil
        backend?.disconnect()
        backend = nil
        recent.removeAll()
        home = HomeSnapshot()
        connection = .idle
    }

    /// `fromUser: false` for schedules and timers, so they don't keep StandBy away.
    func perform(_ command: HomeCommand, fromUser: Bool = true) {
        if fromUser { lastUserAction = Date() }
        if case let .setLight(id, _) = command, let light = home.lights.first(where: { $0.id == id }), light.isOn {
            lastLevels[id] = light.level
        }
        home.apply(command)
        if let key = command.stateKey { recent[key] = (command, Date()) }
        guard let backend else { return }
        Task { [weak self] in
            do {
                try await backend.perform(command)
            } catch {
                self?.showError(error.localizedDescription)
            }
        }
    }

    /// Tap-to-toggle for a light: off, or back to the brightness it had.
    func toggle(light id: String) {
        guard let light = home.lights.first(where: { $0.id == id }) else { return }
        let level = light.isOn ? 0 : (light.isDimmable ? lastLevels[id] ?? 1 : 1)
        perform(.setLight(id: id, level: level))
    }

    func noteInteraction() {
        lastUserAction = Date()
    }

    /// Wakes StandBy and keeps it away while the doorbell card is up (it closes after 90 s).
    func wakeScreen() {
        lastUserAction = Date().addingTimeInterval(90)
        wakeRequests += 1
    }

    /// Shows the doorbell pop-up as if the button was pressed (Settings › Test doorbell).
    func testDoorbell(_ id: String) {
        if let demo = backend as? DemoBackend {
            demo.ring(id)
        } else if let i = home.doorbells.firstIndex(where: { $0.id == id }) {
            home.doorbells[i].ringAt = Date()
        }
    }

    private func receive(_ snapshot: HomeSnapshot) {
        // Keep what the user just set for a few seconds; processors report the old
        // value until the load actually reaches it.
        var merged = snapshot
        let now = Date()
        recent = recent.filter { now.timeIntervalSince($0.value.at) < 3 }
        for entry in recent.values { merged.apply(entry.command) }
        if merged != home { home = merged }
    }

    private func showError(_ message: String) {
        commandError = message
        errorTask?.cancel()
        errorTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.commandError = nil
        }
    }
}
