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
        case .mediaTransport, .setSecurity, .gate:
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
    static let dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

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
        func area(_ roomId: String?, _ label: String) -> String {
            guard let roomId else { return "All \(label)" }
            return "\(home.room(roomId)?.name ?? "Room") \(label)"
        }
        switch action {
        case let .scene(id):
            let name = home.scenes.first(where: { $0.id == id })?.name ?? "removed scene"
            return "Scene: \(name)"
        case let .lights(roomId, level):
            let what = level <= 0 ? "off" : level >= 1 ? "on" : "to \(level.percentText)"
            return "\(area(roomId, "lights")) \(what)"
        case let .shades(roomId, position):
            return "\(area(roomId, "shades")) \(position >= 0.5 ? "open" : "closed")"
        case .mediaOff:
            return "Turn off all music and TV"
        case .lockAll:
            return "Lock all doors"
        case let .command(command):
            switch command {
            case let .light(id, level):
                return "\(home.lights.first(where: { $0.id == id })?.name ?? "Light") \(level > 0 ? "on" : "off")"
            case let .shade(id, position):
                return "\(home.shades.first(where: { $0.id == id })?.name ?? "Shade") \(position >= 0.5 ? "open" : "closed")"
            case let .mediaPower(id, on):
                return "\(home.media.first(where: { $0.id == id })?.name ?? "Music") \(on ? "on" : "off")"
            case let .stopShade(id):
                return "\(home.shades.first(where: { $0.id == id })?.name ?? "Shade") stop"
            case let .scene(id):
                return "Scene: \(home.scenes.first(where: { $0.id == id })?.name ?? "removed scene")"
            case let .mediaVolume(id, level):
                return "\(home.media.first(where: { $0.id == id })?.name ?? "Music") volume \(level.percentText)"
            case let .mediaMute(id, muted):
                return "\(home.media.first(where: { $0.id == id })?.name ?? "Music") \(muted ? "muted" : "unmuted")"
            case let .mediaSource(id, sourceId):
                let zone = home.media.first(where: { $0.id == id })
                return "\(zone?.name ?? "Music") → \(zone?.sources.first(where: { $0.id == sourceId })?.name ?? "source")"
            case let .lock(id):
                return "Lock \(home.locks.first(where: { $0.id == id })?.name ?? "door")"
            }
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
        let dayText: String
        if days.count == 7 {
            dayText = "Every day"
        } else if days == [1, 2, 3, 4, 5] {
            dayText = "Weekdays"
        } else if days == [0, 6] {
            dayText = "Weekends"
        } else {
            dayText = days.map { dayNames[$0] }.joined(separator: ", ")
        }
        switch schedule.trigger {
        case .time:
            return "\(dayText) at \(timeText(schedule.minutes))"
        case .sunrise, .sunset:
            let event = schedule.trigger.rawValue
            if schedule.offset == 0 { return "\(dayText) at \(event)" }
            return "\(dayText), \(abs(schedule.offset)) min \(schedule.offset < 0 ? "before" : "after") \(event)"
        }
    }

    /// "11:00 PM" for minutes after midnight.
    static func timeText(_ minutes: Int) -> String {
        let date = Calendar.current.date(bySettingHour: (minutes / 60) % 24, minute: minutes % 60, second: 0, of: Date()) ?? Date()
        return date.formatted(date: .omitted, time: .shortened)
    }

    /// Checks a schedule before it is saved. Returns the problem, or nil.
    static func validate(_ schedule: HomeSchedule) -> String? {
        if schedule.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Give the schedule a name." }
        if schedule.trigger == .time && !(0..<(24 * 60)).contains(schedule.minutes) { return "Pick a time." }
        if schedule.days.isEmpty || schedule.days.contains(where: { !(0...6).contains($0) }) { return "Pick the days." }
        if schedule.actions.isEmpty { return "Add at least one action." }
        return nil
    }

    /// "5 min", "1 h 20 min".
    static func minutesLeft(_ at: Date, now: Date = Date()) -> String {
        let m = max(1, Int((at.timeIntervalSince(now) / 60).rounded()))
        guard m >= 60 else { return "\(m) min" }
        return m % 60 == 0 ? "\(m / 60) h" : "\(m / 60) h \(m % 60) min"
    }

    /// "Today 11:00 PM", "Tomorrow 7:00 AM", "Friday 6:12 PM".
    static func whenText(_ at: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        let diff = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: at)).day ?? 0
        let name = diff == 0 ? "Today" : diff == 1 ? "Tomorrow" : at.formatted(.dateTime.weekday(.wide))
        return "\(name) \(at.formatted(date: .omitted, time: .shortened))"
    }

    /// Ideas shown on the Automations page.
    static let templates: [HomeSchedule] = [
        HomeSchedule(name: "Lights off at bedtime", minutes: 23 * 60, actions: [.lights(roomId: nil, level: 0)]),
        HomeSchedule(name: "Close shades at sunset", trigger: .sunset, actions: [.shades(roomId: nil, position: 0)]),
        HomeSchedule(name: "Open shades in the morning", minutes: 7 * 60, days: [1, 2, 3, 4, 5], actions: [.shades(roomId: nil, position: 1)]),
        HomeSchedule(name: "Lock up at night", minutes: 22 * 60 + 30, actions: [.lockAll]),
    ]
}
