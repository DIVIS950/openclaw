import Foundation

// Schedules, timers and vacation mode. They run on this iPad while the app is open
// (a wall iPad keeps it open all day), checked every 20 seconds by AutomationStore.

enum ScheduleTrigger: String, Codable, Hashable, CaseIterable {
    case time, sunrise, sunset
}

/// One device set to a value, for timers ("turn off in 30 min"). Ask Home can time any of
/// these; nothing here can open the house (locks can only be locked).
enum TimerCommand: Codable, Hashable {
    case light(id: String, level: Double)
    case shade(id: String, position: Double)
    case mediaPower(id: String, on: Bool)
    case stopShade(id: String)
    case scene(id: String)
    case mediaVolume(id: String, level: Double)
    case mediaMute(id: String, muted: Bool)
    case mediaSource(id: String, sourceId: String)
    case lock(id: String)
    case climate(id: String, target: Double)
    case mode(id: String, value: String)
    case setSwitch(id: String, on: Bool)

    var homeCommand: HomeCommand {
        switch self {
        case let .light(id, level): return .setLight(id: id, level: level)
        case let .shade(id, position): return .setShade(id: id, position: position)
        case let .mediaPower(id, on): return .mediaPower(zoneId: id, on: on)
        case let .stopShade(id): return .stopShade(id: id)
        case let .scene(id): return .recallScene(id: id)
        case let .mediaVolume(id, level): return .mediaVolume(zoneId: id, level: level)
        case let .mediaMute(id, muted): return .mediaMute(zoneId: id, muted: muted)
        case let .mediaSource(id, sourceId): return .mediaSource(zoneId: id, sourceId: sourceId)
        case let .lock(id): return .setLock(id: id, locked: true)
        case let .climate(id, target): return .setClimate(id: id, target: target)
        case let .mode(id, value): return .setMode(id: id, value: value)
        case let .setSwitch(id, on): return .setSwitch(id: id, on: on)
        }
    }

    /// The timer version of a house command, or nil for commands that can't be timed
    /// (unlocking, the gate, the alarm, play/pause).
    init?(_ command: HomeCommand) {
        switch command {
        case let .setLight(id, level): self = .light(id: id, level: level)
        case let .setShade(id, position): self = .shade(id: id, position: position)
        case let .stopShade(id): self = .stopShade(id: id)
        case let .recallScene(id): self = .scene(id: id)
        case let .mediaPower(id, on): self = .mediaPower(id: id, on: on)
        case let .mediaVolume(id, level): self = .mediaVolume(id: id, level: level)
        case let .mediaMute(id, muted): self = .mediaMute(id: id, muted: muted)
        case let .mediaSource(id, sourceId): self = .mediaSource(id: id, sourceId: sourceId)
        case let .setLock(id, locked):
            guard locked else { return nil }
            self = .lock(id: id)
        case let .setClimate(id, target): self = .climate(id: id, target: target)
        case let .setMode(id, value): self = .mode(id: id, value: value)
        case let .setSwitch(id, on): self = .setSwitch(id: id, on: on)
        case .mediaTransport, .setSecurity, .gate, .tvKey, .tvApp, .mediaChannel:
            return nil
        }
    }
}

/// What a schedule or timer does. Lights and shades with no room mean the whole house.
enum AutomationAction: Codable, Hashable {
    case scene(id: String)
    case lights(roomId: String?, level: Double)
    case shades(roomId: String?, position: Double)
    case mediaOff
    case lockAll
    case command(TimerCommand)
}

struct HomeSchedule: Codable, Hashable, Identifiable {
    var id = UUID().uuidString
    var name: String
    var enabled = true
    var trigger: ScheduleTrigger = .time
    /// Minutes after midnight, for `.time`.
    var minutes = 23 * 60
    /// Minutes before (negative) or after sunrise or sunset.
    var offset = 0
    /// 0 = Sunday … 6 = Saturday.
    var days: [Int] = AutomationRules.everyDay
    var actions: [AutomationAction] = []
    /// Day ("2026-11-02") it last ran, so it runs once a day.
    var lastRun = ""
}

struct HomeTimer: Codable, Hashable, Identifiable {
    var id = UUID().uuidString
    var label: String
    var at: Date
    var actions: [AutomationAction]
}

/// Lights go on and off through the evening, as if someone were home.
struct VacationMode: Codable, Hashable {
    var enabled = false
    /// When the next light changes.
    var next = Date.distantPast
    /// Day the lights were last switched off at the end of the evening.
    var offDay = ""
}

struct Automations: Codable, Hashable {
    var schedules: [HomeSchedule] = []
    var timers: [HomeTimer] = []
    var vacation = VacationMode()
}

/// The rules, without any state: what an action does, when a schedule runs, plain words for both.
enum AutomationRules {
    static let everyDay = [0, 1, 2, 3, 4, 5, 6]
    /// Short day names, 0 = Sunday.
    static var dayNames: [String] {
        L10n.isCzech ? ["Ne", "Po", "Út", "St", "Čt", "Pá", "So"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    }

    /// Full day names for VoiceOver, 0 = Sunday.
    static var fullDayNames: [String] {
        L10n.isCzech
            ? ["neděle", "pondělí", "úterý", "středa", "čtvrtek", "pátek", "sobota"]
            : ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    }

    /// "2026-11-02" in local time.
    static func dayKey(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// 0 = Sunday … 6 = Saturday.
    static func weekday(_ date: Date) -> Int {
        Calendar.current.component(.weekday, from: date) - 1
    }

    /// The days a schedule runs, sorted; every day when none are valid.
    static func activeDays(_ schedule: HomeSchedule) -> [Int] {
        let valid = Set(schedule.days.filter { (0...6).contains($0) })
        return valid.isEmpty ? everyDay : valid.sorted()
    }

    /// The house commands one action stands for, given the house as it is now.
    static func expand(_ action: AutomationAction, home: HomeSnapshot) -> [HomeCommand] {
        switch action {
        case let .scene(id):
            return [HomeCommand.recallScene(id: id)]
        case let .lights(roomId, level):
            return home.lights.filter { roomId == nil || $0.roomId == roomId }
                .map { HomeCommand.setLight(id: $0.id, level: level) }
        case let .shades(roomId, position):
            return home.shades.filter { roomId == nil || $0.roomId == roomId }
                .map { HomeCommand.setShade(id: $0.id, position: position) }
        case .mediaOff:
            return home.media.filter(\.isOn).map { HomeCommand.mediaPower(zoneId: $0.id, on: false) }
        case .lockAll:
            return home.locks.filter { $0.isLocked != true }.map { HomeCommand.setLock(id: $0.id, locked: true) }
        case let .command(command):
            return [command.homeCommand]
        }
    }

    /// Plain words for an action: "Living Room lights off", "Scene: Good Night".
    static func describe(_ action: AutomationAction, home: HomeSnapshot) -> String {
        func room(_ roomId: String) -> String { home.room(roomId)?.name ?? L("Room") }
        switch action {
        case let .scene(id):
            let name = home.scenes.first(where: { $0.id == id })?.name ?? L("removed scene")
            return L("Scene: {name}", ["name": name])
        case let .lights(roomId, level):
            if let roomId {
                let vars = ["room": room(roomId), "level": level.percentText]
                return level <= 0 ? L("{room} lights off", vars) : level >= 1 ? L("{room} lights on", vars) : L("{room} lights to {level}", vars)
            }
            return level <= 0 ? L("Turn all lights off") : level >= 1 ? L("Turn all lights on") : L("All lights to {level}", ["level": level.percentText])
        case let .shades(roomId, position):
            if let roomId {
                let vars = ["room": room(roomId)]
                return position >= 0.5 ? L("Open {room} shades", vars) : L("Close {room} shades", vars)
            }
            return position >= 0.5 ? L("Open all shades") : L("Close all shades")
        case .mediaOff:
            return L("Turn off all music and TV")
        case .lockAll:
            return L("Lock all doors")
        case let .command(command):
            return describe(command, home: home)
        }
    }

    /// Plain words for one timed command: "Ceiling off", "Sauna on", "Obývák → 22 °C".
    static func describe(_ command: TimerCommand, home: HomeSnapshot) -> String {
        func on(_ name: String, _ isOn: Bool) -> String {
            isOn ? L("{name} on", ["name": name]) : L("{name} off", ["name": name])
        }
        switch command {
        case let .light(id, level):
            return on(home.lights.first(where: { $0.id == id })?.name ?? L("Light"), level > 0)
        case let .shade(id, position):
            let name = home.shades.first(where: { $0.id == id })?.name ?? L("Shade")
            return position >= 0.5 ? L("{name} open", ["name": name]) : L("{name} closed", ["name": name])
        case let .mediaPower(id, isOn):
            return on(home.media.first(where: { $0.id == id })?.name ?? L("Music"), isOn)
        case let .stopShade(id):
            return L("{name} stop", ["name": home.shades.first(where: { $0.id == id })?.name ?? L("Shade")])
        case let .scene(id):
            return L("Scene: {name}", ["name": home.scenes.first(where: { $0.id == id })?.name ?? L("removed scene")])
        case let .mediaVolume(id, level):
            return L("{name} volume {level}", ["name": home.media.first(where: { $0.id == id })?.name ?? L("Music"), "level": level.percentText])
        case let .mediaMute(id, muted):
            let name = home.media.first(where: { $0.id == id })?.name ?? L("Music")
            return muted ? L("{name} muted", ["name": name]) : L("{name} unmuted", ["name": name])
        case let .mediaSource(id, sourceId):
            let zone = home.media.first(where: { $0.id == id })
            return "\(zone?.name ?? L("Music")) → \(zone?.sources.first(where: { $0.id == sourceId })?.name ?? L("source"))"
        case let .lock(id):
            return L("Lock {name}", ["name": home.locks.first(where: { $0.id == id })?.name ?? L("door")])
        case let .climate(id, target):
            return "\(home.climate.first(where: { $0.id == id })?.name ?? L("Heating")) → \(L10n.temp(target))"
        case let .mode(id, value):
            let mode = home.modes.first(where: { $0.id == id })
            return "\(mode?.name ?? L("Mode")) → \(mode?.options.first(where: { $0.id == value })?.name ?? value)"
        case let .setSwitch(id, isOn):
            return on(home.switches.first(where: { $0.id == id })?.name ?? L("Switch"), isOn)
        }
    }

    /// When a schedule fires on the day of `date`, or nil (no sunrise that day, no location).
    static func trigger(_ schedule: HomeSchedule, on date: Date, place: HomeLocation?) -> Date? {
        let calendar = Calendar.current
        switch schedule.trigger {
        case .time:
            let minutes = min(max(0, schedule.minutes), 24 * 60 - 1)
            return calendar.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: date)
        case .sunrise, .sunset:
            guard let place, let sun = Sun.times(on: date, lat: place.lat, lon: place.lon) else { return nil }
            let event = schedule.trigger == .sunrise ? sun.sunrise : sun.sunset
            return event.addingTimeInterval(Double(schedule.offset) * 60)
        }
    }

    /// The next time a schedule will run, looking a week ahead.
    static func nextRun(_ schedule: HomeSchedule, after now: Date, place: HomeLocation?) -> Date? {
        guard schedule.enabled else { return nil }
        let days = activeDays(schedule)
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let todayKey = dayKey(now)
        for i in 0..<8 {
            guard let day = calendar.date(byAdding: .day, value: i, to: today), days.contains(weekday(day)) else { continue }
            if i == 0 && schedule.lastRun == todayKey { continue }
            if let at = trigger(schedule, on: day, place: place), at > now { return at }
        }
        return nil
    }

    /// "Every day at 11:00 PM", "Weekdays, 30 min after sunset".
    static func describeWhen(_ schedule: HomeSchedule) -> String {
        let days = activeDays(schedule)
        let names = dayNames
        let dayText: String
        if days.count == 7 {
            dayText = L("Every day")
        } else if days == [1, 2, 3, 4, 5] {
            dayText = L("Weekdays")
        } else if days == [0, 6] {
            dayText = L("Weekends")
        } else {
            dayText = days.map { names[$0] }.joined(separator: ", ")
        }
        switch schedule.trigger {
        case .time:
            return L("{days} at {time}", ["days": dayText, "time": timeText(schedule.minutes)])
        case .sunrise, .sunset:
            let vars = ["days": dayText, "min": String(abs(schedule.offset))]
            let sunrise = schedule.trigger == .sunrise
            if schedule.offset == 0 { return sunrise ? L("{days} at sunrise", vars) : L("{days} at sunset", vars) }
            if schedule.offset < 0 { return sunrise ? L("{days}, {min} min before sunrise", vars) : L("{days}, {min} min before sunset", vars) }
            return sunrise ? L("{days}, {min} min after sunrise", vars) : L("{days}, {min} min after sunset", vars)
        }
    }

    /// "23:00" for minutes after midnight.
    static func timeText(_ minutes: Int) -> String {
        let date = Calendar.current.date(bySettingHour: (minutes / 60) % 24, minute: minutes % 60, second: 0, of: Date()) ?? Date()
        return L10n.time(date)
    }

    /// Checks a schedule before it is saved. Returns the problem, or nil.
    static func validate(_ schedule: HomeSchedule) -> String? {
        if schedule.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return L("Give the schedule a name.") }
        if schedule.trigger == .time && !(0..<(24 * 60)).contains(schedule.minutes) { return L("Pick a time.") }
        if schedule.days.isEmpty || schedule.days.contains(where: { !(0...6).contains($0) }) { return L("Pick the days.") }
        if schedule.actions.isEmpty { return L("Add at least one action.") }
        return nil
    }

    /// "5 min", "1 h 20 min".
    static func minutesLeft(_ at: Date, now: Date = Date()) -> String {
        let m = max(1, Int((at.timeIntervalSince(now) / 60).rounded()))
        guard m >= 60 else { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) h" : "\(m / 60) h \(m % 60) min"
    }

    /// "Today 23:00", "Tomorrow 7:00", "Friday 18:12".
    static func whenText(_ at: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        let diff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: at)).day ?? 0
        let name = diff == 0 ? L("Today") : diff == 1 ? L("Tomorrow") : L10n.weekday(at)
        return "\(name) \(L10n.time(at))"
    }

    /// Ideas shown on the Automations page, named in the app's language.
    static var templates: [HomeSchedule] {
        [
            HomeSchedule(name: L("Lights off at bedtime"), minutes: 23 * 60, actions: [.lights(roomId: nil, level: 0)]),
            HomeSchedule(name: L("Close shades at sunset"), trigger: .sunset, actions: [.shades(roomId: nil, position: 0)]),
            HomeSchedule(name: L("Open shades in the morning"), minutes: 7 * 60, days: [1, 2, 3, 4, 5], actions: [.shades(roomId: nil, position: 1)]),
            HomeSchedule(name: L("Lock up at night"), minutes: 22 * 60 + 30, actions: [.lockAll]),
        ]
    }
}
