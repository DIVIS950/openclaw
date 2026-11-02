import Foundation
import Observation

/// Schedules, timers and vacation mode, kept on this iPad (UserDefaults) and run by it.
/// There is no server in the native app: they run while the app is open, which is how
/// a wall iPad is used.
@MainActor
@Observable
final class AutomationStore {
    private(set) var automations = Automations()

    @ObservationIgnored private var loop: Task<Void, Never>?
    private static let key = "automations"

    init() {
        if let data = UserDefaults.standard.data(forKey: Self.key),
           let saved = try? JSONDecoder().decode(Automations.self, from: data) {
            automations = saved
        }
    }

    var schedules: [HomeSchedule] { automations.schedules }
    var timers: [HomeTimer] { automations.timers.sorted { $0.at < $1.at } }
    var vacation: VacationMode { automations.vacation }
    /// Schedules that are on plus running timers, for the sidebar.
    var activeCount: Int { automations.schedules.filter(\.enabled).count + automations.timers.count }

    /// The demo house starts with one example schedule, like the web demo.
    func seedDemoIfNew(mode: ConnectionMode) {
        guard mode == .demo, UserDefaults.standard.data(forKey: Self.key) == nil else { return }
        automations.schedules = [
            HomeSchedule(name: "Lights off at bedtime", minutes: 23 * 60, actions: [.lights(roomId: nil, level: 0)]),
        ]
        save()
    }

    /// Checks schedules and timers every 20 seconds while the app runs.
    func start(store: HomeStore, settings: AppSettings) {
        loop?.cancel()
        loop = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick(store: store, place: settings.effectiveLocation)
                try? await Task.sleep(for: .seconds(20))
            }
        }
    }

    // MARK: Changes from the app

    /// Adds a new schedule or replaces the one with the same id (keeping when it last ran).
    func save(_ schedule: HomeSchedule) {
        var s = schedule
        s.name = String(s.name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(60))
        if let i = automations.schedules.firstIndex(where: { $0.id == s.id }) {
            s.lastRun = automations.schedules[i].lastRun
            automations.schedules[i] = s
        } else {
            automations.schedules.append(s)
        }
        save()
    }

    func deleteSchedule(id: String) {
        automations.schedules.removeAll { $0.id == id }
        save()
    }

    func setEnabled(_ enabled: Bool, schedule id: String) {
        guard let i = automations.schedules.firstIndex(where: { $0.id == id }) else { return }
        automations.schedules[i].enabled = enabled
        save()
    }

    func setVacation(_ enabled: Bool) {
        automations.vacation.enabled = enabled
        automations.vacation.next = .distantPast
        save()
    }

    func addTimer(minutes: Int, label: String, command: TimerCommand) {
        addTimer(minutes: minutes, label: label, commands: [command])
    }

    /// One timer that runs several commands at once (Ask Home: "in 30 minutes turn off the kitchen").
    func addTimer(minutes: Int, label: String, commands: [TimerCommand]) {
        guard !commands.isEmpty else { return }
        let timer = HomeTimer(label: String(label.prefix(80)), at: Date().addingTimeInterval(Double(minutes) * 60),
                              actions: commands.map { AutomationAction.command($0) })
        automations.timers = Array((automations.timers + [timer]).suffix(50))
        save()
    }

    func cancelTimer(id: String) {
        automations.timers.removeAll { $0.id == id }
        save()
    }

    // MARK: Running

    /// Runs due schedules and timers and drives vacation mode.
    func tick(store: HomeStore, place: HomeLocation?, now: Date = Date()) {
        // Wait for the house; commands sent before that would go nowhere.
        guard store.connection == .connected else { return }
        let home = store.home
        var a = automations
        let today = AutomationRules.dayKey(now)
        let weekday = AutomationRules.weekday(now)
        var changed = false

        for i in a.schedules.indices {
            let s = a.schedules[i]
            guard s.enabled, s.lastRun != today, AutomationRules.activeDays(s).contains(weekday),
                  let at = AutomationRules.trigger(s, on: now, place: place)
            else { continue }
            // Run once the time has come, but not if the iPad was off for more than 10 minutes past it.
            if now >= at && now.timeIntervalSince(at) < 10 * 60 {
                a.schedules[i].lastRun = today
                changed = true
                run(s.actions, home: home, store: store)
            }
        }

        let due = a.timers.filter { $0.at <= now }
        if !due.isEmpty {
            a.timers.removeAll { $0.at <= now }
            changed = true
            for timer in due { run(timer.actions, home: home, store: store) }
        }

        if a.vacation.enabled && !home.lights.isEmpty {
            if vacationStep(&a.vacation, home: home, now: now, place: place, today: today, store: store) { changed = true }
        }

        if changed {
            automations = a
            save()
        }
    }

    /// Lights come on and go off at random from sunset (6 PM without a location) until 11:30 PM,
    /// then all go off.
    private func vacationStep(_ v: inout VacationMode, home: HomeSnapshot, now: Date, place: HomeLocation?,
                              today: String, store: HomeStore) -> Bool {
        let calendar = Calendar.current
        let sunset = place.flatMap { Sun.times(on: now, lat: $0.lat, lon: $0.lon)?.sunset }
        let start = sunset ?? calendar.date(bySettingHour: 18, minute: 0, second: 0, of: now) ?? now
        let end = calendar.date(bySettingHour: 23, minute: 30, second: 0, of: now) ?? now
        if now >= start && now < end {
            guard now >= v.next, let light = home.lights.randomElement() else { return false }
            store.perform(.setLight(id: light.id, level: light.isOn ? 0 : 0.7), fromUser: false)
            v.next = now.addingTimeInterval(Double.random(in: 15...45) * 60)
            return true
        }
        if now >= end && v.offDay != today {
            v.offDay = today
            for light in home.lights where light.isOn {
                store.perform(.setLight(id: light.id, level: 0), fromUser: false)
            }
            return true
        }
        return false
    }

    private func run(_ actions: [AutomationAction], home: HomeSnapshot, store: HomeStore) {
        for action in actions {
            for command in AutomationRules.expand(action, home: home) {
                store.perform(command, fromUser: false)
            }
        }
    }

    private func save() {
        UserDefaults.standard.set(try? JSONEncoder().encode(automations), forKey: Self.key)
    }
}
