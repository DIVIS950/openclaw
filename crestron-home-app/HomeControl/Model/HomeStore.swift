import Foundation
import Observation

/// The single source of truth the views read. Owns the sources (the main system plus
/// Apple Home and Samsung TVs when turned on), merges their snapshots into one home,
/// routes commands to the system that owns the device, and applies them optimistically.
@MainActor
@Observable
final class HomeStore {
    enum Connection: Equatable {
        case idle, connecting, connected
        case failed(String)
    }

    private(set) var home = HomeSnapshot()
    /// The main system's connection (demo, Crestron Home or the custom program).
    private(set) var connection: Connection = .idle
    /// The extra systems' connections, by source name ("homekit", "samsungtv").
    private(set) var extraStatus: [String: Connection] = [:]
    /// Each Samsung TV's pairing state in plain words, by its address (for Settings).
    private(set) var tvStatus: [String: String] = [:]
    private(set) var mode: ConnectionMode = .demo
    /// Short-lived message for a command that didn't go through.
    private(set) var commandError: String?
    /// Last time the user touched a control (drives the wall-panel screensaver).
    private(set) var lastUserAction = Date()
    /// Goes up when something needs the screen awake (the doorbell); RootView hides StandBy.
    private(set) var wakeRequests = 0
    /// Goes up each time a device is changed from this iPad (keys like "light:l1"), so its
    /// tile can play a short "just changed" animation.
    private(set) var pulses: [String: Int] = [:]

    @ObservationIgnored private var sources: [HomeSource] = []
    @ObservationIgnored private var errorTask: Task<Void, Never>?
    @ObservationIgnored private var recent: [String: (command: HomeCommand, at: Date)] = [:]
    /// Brightness each light had before it was turned off, so tapping it back on restores it.
    @ObservationIgnored private var lastLevels: [String: Double] = [:]

    /// Connects everything: the main system first, then the extra sources that are set up.
    func connect(using settings: AppSettings) {
        disconnect()
        mode = settings.mode
        do {
            let backend = try settings.makeBackend()
            sources.append(HomeSource(name: "main", backend: backend, isMain: true, idPrefix: nil))
        } catch {
            connection = .failed(error.localizedDescription)
        }
        let extras = makeExtras(settings)
        sources += extras
        for source in sources { source.start { [weak self] in self?.refresh() } }
        refresh()
    }

    /// Restarts only Apple Home and the TVs (after their settings changed); the main system stays up.
    func reconnectExtras(using settings: AppSettings) {
        for source in sources where !source.isMain { source.stop() }
        sources.removeAll { !$0.isMain }
        let extras = makeExtras(settings)
        sources += extras
        for source in extras { source.start { [weak self] in self?.refresh() } }
        refresh()
    }

    func disconnect() {
        for source in sources { source.stop() }
        sources.removeAll()
        recent.removeAll()
        home = HomeSnapshot()
        connection = .idle
        extraStatus = [:]
        tvStatus = [:]
    }

    private func makeExtras(_ settings: AppSettings) -> [HomeSource] {
        var extras: [HomeSource] = []
        tvStatus = [:]
        if settings.homeKitEnabled {
            extras.append(HomeSource(name: HomeKitSource.sourceName, backend: HomeKitSource(), isMain: false, idPrefix: HomeKitSource.idPrefix))
        }
        let tvs = settings.samsungTVs.filter { !$0.host.trimmingCharacters(in: .whitespaces).isEmpty }
        if !tvs.isEmpty {
            let backend = SamsungTVSource(tvs: tvs)
            backend.onTVStatus = { [weak self] status in self?.tvStatus = status }
            extras.append(HomeSource(name: SamsungTVSource.sourceName, backend: backend, isMain: false, idPrefix: SamsungTVSource.idPrefix))
        }
        return extras
    }

    /// `fromUser: false` for schedules and timers, so they don't keep StandBy away.
    func perform(_ command: HomeCommand, fromUser: Bool = true) {
        if fromUser { lastUserAction = Date() }
        if case let .setLight(id, _) = command, let light = home.lights.first(where: { $0.id == id }), light.isOn {
            lastLevels[id] = light.level
        }
        home.apply(command)
        if let key = command.stateKey { recent[key] = (command, Date()) }
        if fromUser, let key = command.tileKey { pulses[key, default: 0] += 1 }
        // `owner`, not `source`: a local named like the method would shadow it in its own initializer.
        guard let owner = source(owning: command.deviceId) else { return }
        let backend = owner.backend
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

    /// How many times the device behind a tile was changed from this iPad (see `pulses`).
    func pulse(_ key: String) -> Int { pulses[key] ?? 0 }

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
        if let demo = sources.first(where: \.isMain)?.backend as? DemoBackend {
            demo.ring(id)
        } else if let i = home.doorbells.firstIndex(where: { $0.id == id }) {
            home.doorbells[i].ringAt = Date()
        }
    }

    /// The extra source that owns the id by prefix, else the main system.
    private func source(owning id: String) -> HomeSource? {
        sources.first { !$0.isMain && $0.owns(id: id) } ?? sources.first(where: \.isMain)
    }

    /// Rebuilds `home` from every source, main first, and the status lines. Keeps what the
    /// user just set for a few seconds; processors report the old value until the load
    /// actually reaches it.
    private func refresh() {
        var merged = HomeSnapshot()
        for source in sources { merged.merge(source.snapshot) }
        let now = Date()
        recent = recent.filter { now.timeIntervalSince($0.value.at) < 3 }
        for entry in recent.values { merged.apply(entry.command) }
        if merged != home { home = merged }
        if let main = sources.first(where: \.isMain), main.connection != connection { connection = main.connection }
        var status: [String: Connection] = [:]
        for source in sources where !source.isMain { status[source.name] = source.connection }
        if status != extraStatus { extraStatus = status }
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

extension HomeCommand {
    /// Key of the tile this command changes, for the "just changed" animation.
    var tileKey: String? {
        switch self {
        case let .setLight(id, _): "light:\(id)"
        case let .setShade(id, _): "shade:\(id)"
        case let .mediaPower(id, _), let .mediaSource(id, _), let .tvApp(id, _), let .mediaChannel(id, _): "media:\(id)"
        case let .setLock(id, _): "lock:\(id)"
        case let .recallScene(id): "scene:\(id)"
        case let .setClimate(id, _): "climate:\(id)"
        case let .setSwitch(id, _): "switch:\(id)"
        case .stopShade, .mediaVolume, .mediaMute, .mediaTransport, .setSecurity, .gate, .setMode, .tvKey: nil
        }
    }
}
