import SwiftUI

// The Automations page, the "Coming up" part of Home and the schedule editor.
// Schedules and timers run on this iPad while the app is open (see AutomationStore).

/// One line in "Coming up" or the timers list.
struct HVUpcomingItem: Identifiable {
    let id: String
    let at: Date
    let symbol: String
    let color: Color
    let title: String
    let detail: String
    var timerId: String?

    /// Running timers and the next run of each schedule, soonest first.
    @MainActor
    static func list(_ automations: AutomationStore, home: HomeSnapshot, place: HomeLocation?, now: Date, limit: Int = 4) -> [HVUpcomingItem] {
        var items = automations.timers.map { timer in
            HVUpcomingItem(id: "timer:\(timer.id)", at: timer.at, symbol: "timer", color: .orange, title: timer.label,
                           detail: L("in {time}", ["time": AutomationRules.minutesLeft(timer.at, now: now)]), timerId: timer.id)
        }
        for schedule in automations.schedules {
            guard let at = AutomationRules.nextRun(schedule, after: now, place: place) else { continue }
            let actions = schedule.actions.map { AutomationRules.describe($0, home: home) }.joined(separator: ", ")
            items.append(HVUpcomingItem(id: "schedule:\(schedule.id)", at: at, symbol: "calendar", color: .green, title: schedule.name,
                                        detail: "\(AutomationRules.whenText(at, now: now)) · \(actions)"))
        }
        return Array(items.sorted { $0.at < $1.at }.prefix(limit))
    }
}

@MainActor
struct HVUpcomingRow: View {
    let item: HVUpcomingItem
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: item.symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(item.color))
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                Text(item.detail).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 0)
            if let timerId = item.timerId {
                Button {
                    automations.cancelTimer(id: timerId)
                    nav.notify(L("Timer cancelled"), symbol: "timer", color: .orange)
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.secondary)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(Color.primary.opacity(0.1)))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel(L("Cancel {name}", ["name": item.title]))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .hvGlass(20)
    }
}

/// "Coming up" on Home: the next schedules and running timers.
@MainActor
struct HVUpcomingPart: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav

    var body: some View {
        // Redraw every 30 seconds so "in 12 min" counts down.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            let items = HVUpcomingItem.list(automations, home: store.home, place: settings.effectiveLocation, now: context.date)
            HVSection(title: L("Coming up"), open: { nav.go(.automations) },
                      badge: automations.vacation.enabled ? L("Vacation mode on") : nil) {
                if items.isEmpty {
                    HVEmptyRow(symbol: "calendar", title: L("Nothing scheduled"),
                               text: L("Make lights and shades follow a schedule, or set a timer from any light."),
                               buttonTitle: L("New schedule")) { nav.go(.automations) }
                } else {
                    VStack(spacing: 10) {
                        ForEach(items) { HVUpcomingRow(item: $0) }
                    }
                }
            }
        }
    }
}

// MARK: - Automations page

@MainActor
struct HVAutomationsPage: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let on = automations.schedules.filter(\.enabled).count
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: L("Automations"),
                     title: on > 0 ? Ln(on, "{n} schedule is on", "{n} schedules are on") : L("Automations"),
                     subtitle: L("Schedules and timers run on this iPad while the app is open. A wall iPad keeps it open all day."))
            vacationCard
            HVSection(title: L("Schedules")) {
                VStack(alignment: .leading, spacing: 10) {
                    if automations.schedules.isEmpty {
                        HVEmptyRow(symbol: "calendar", title: L("No schedules yet"),
                                   text: L("For example: lights off at 23:00, or shades closed at sunset."))
                    }
                    TimelineView(.everyMinute) { context in
                        VStack(spacing: 10) {
                            ForEach(automations.schedules) { scheduleCard($0, now: context.date) }
                        }
                    }
                    HVFlow(spacing: 8) {
                        capsule(L("New schedule"), "plus") {
                            nav.sheet = .schedule(HomeSchedule(name: "", actions: []))
                        }
                        ForEach(ideas(home), id: \.name) { idea in
                            capsule(idea.name, "lightbulb") {
                                var draft = idea
                                draft.id = UUID().uuidString
                                nav.sheet = .schedule(draft)
                            }
                        }
                    }
                    .padding(.top, 4)
                }
            }
            HVSection(title: L("Timers")) {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    let timers = automations.timers
                    if timers.isEmpty {
                        HVEmptyRow(symbol: "timer", title: L("No timers running"),
                                   text: L("Open any light, shade or music room and pick “Turn off in”."))
                    } else {
                        VStack(spacing: 10) {
                            ForEach(timers) { timer in
                                HVUpcomingRow(item: HVUpcomingItem(
                                    id: timer.id, at: timer.at, symbol: "timer", color: .orange, title: timer.label,
                                    detail: L("in {time}", ["time": AutomationRules.minutesLeft(timer.at, now: context.date)]), timerId: timer.id))
                            }
                        }
                    }
                }
            }
        }
    }

    /// Templates that fit this house (no shade ideas without shades, and so on).
    private func ideas(_ home: HomeSnapshot) -> [HomeSchedule] {
        AutomationRules.templates.filter { idea in
            idea.actions.allSatisfy { action in
                switch action {
                case .shades: return !home.shades.isEmpty
                case .lockAll: return !home.locks.isEmpty
                default: return !home.lights.isEmpty
                }
            }
        }
    }

    private var vacationCard: some View {
        let vacation = automations.vacation
        return HStack(spacing: 14) {
            Image(systemName: "suitcase.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.teal))
            VStack(alignment: .leading, spacing: 2) {
                Text(L("Vacation mode")).font(.subheadline.weight(.semibold))
                Text(L("Lights go on and off through the evening, as if someone were home. All off at 23:30."))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                if vacation.enabled && settings.effectiveLocation == nil {
                    Text(L("Set your town in Settings so it starts at sunset. Until then it starts at 18:00."))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.orange)
                }
            }
            Spacer(minLength: 8)
            Toggle(isOn: Binding(get: { vacation.enabled }, set: { enabled in
                automations.setVacation(enabled)
                nav.notify(enabled ? L("Vacation mode on") : L("Vacation mode off"), symbol: "suitcase.fill", color: .teal)
            })) {
                Text(L("Vacation mode"))
            }
            .labelsHidden()
            .tint(.green)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .hvGlass(20)
        .overlay {
            if vacation.enabled {
                RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.teal.opacity(0.6), lineWidth: 2)
            }
        }
    }

    private func scheduleCard(_ schedule: HomeSchedule, now: Date) -> some View {
        let home = store.home
        let place = settings.effectiveLocation
        let needsPlace = schedule.trigger != .time && place == nil
        let next = AutomationRules.nextRun(schedule, after: now, place: place)
        let symbol = schedule.trigger == .time ? "clock.fill" : schedule.trigger == .sunrise ? "sunrise.fill" : "sunset.fill"
        return HStack(spacing: 12) {
            Button { nav.sheet = .schedule(schedule) } label: {
                HStack(spacing: 14) {
                    Image(systemName: symbol)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.green))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(schedule.name).font(.subheadline.weight(.semibold))
                        Text(AutomationRules.describeWhen(schedule)).font(.footnote).foregroundStyle(.secondary)
                        Text(schedule.actions.map { AutomationRules.describe($0, home: home) }.joined(separator: " · "))
                            .font(.footnote.weight(.medium))
                        if needsPlace {
                            Text(L("Set your town in Settings so it knows when the sun rises and sets."))
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.orange)
                        } else if let next {
                            Text(L("Next: {when}", ["when": AutomationRules.whenText(next, now: now)]))
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.green)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.primary)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(L("Edit this schedule"))
            Toggle(isOn: Binding(get: { schedule.enabled }, set: { automations.setEnabled($0, schedule: schedule.id) })) {
                Text(schedule.name)
            }
            .labelsHidden()
            .tint(.green)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .hvGlass(20)
        .opacity(schedule.enabled ? 1 : 0.6)
    }

    private func capsule(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .hvGlass(30)
        }
        .buttonStyle(HVPress())
    }
}

// MARK: - Schedule editor

@MainActor
struct HVScheduleSheet: View {
    let isNew: Bool
    @State private var draft: HomeSchedule
    @State private var problem: String?
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav

    private let offsets = [-60, -30, -15, 0, 15, 30, 60]

    init(schedule: HomeSchedule, isNew: Bool) {
        self.isNew = isNew
        _draft = State(initialValue: schedule)
        _problem = State(initialValue: nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HVSheetHeader(symbol: "calendar", color: .green, title: isNew ? L("New schedule") : L("Edit schedule"),
                              subtitle: L("Runs by itself on the days you pick"))
                field(L("Name")) {
                    TextField(L("Lights off at bedtime"), text: $draft.name)
                        .font(.body.weight(.medium))
                        .submitLabel(.done)
                        .padding(.horizontal, 14)
                        .frame(height: 46)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.primary.opacity(0.07)))
                }
                field(L("When")) {
                    Picker(L("When"), selection: $draft.trigger) {
                        Text(L("At a time")).tag(ScheduleTrigger.time)
                        Text(L("Sunrise")).tag(ScheduleTrigger.sunrise)
                        Text(L("Sunset")).tag(ScheduleTrigger.sunset)
                    }
                    .pickerStyle(.segmented)
                    if draft.trigger == .time {
                        DatePicker(L("Time"), selection: time, displayedComponents: .hourAndMinute)
                            .font(.body.weight(.medium))
                            .environment(\.locale, L10n.locale)
                    } else {
                        Picker(draft.trigger == .sunrise ? L("Before or after sunrise") : L("Before or after sunset"), selection: $draft.offset) {
                            ForEach(offsets, id: \.self) { Text(offsetText($0)).tag($0) }
                        }
                        .pickerStyle(.menu)
                        if settings.effectiveLocation == nil {
                            Text(L("Set your town in Settings so it knows when the sun rises and sets."))
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.orange)
                        }
                    }
                }
                field(L("Days")) {
                    HStack(spacing: 6) {
                        ForEach(0..<7, id: \.self) { day in
                            let on = draft.days.contains(day)
                            Button { toggle(day) } label: {
                                Text(AutomationRules.dayNames[day])
                                    .font(.body.weight(.bold))
                                    .foregroundStyle(on ? Color.white : Color.primary)
                                    .frame(maxWidth: .infinity, minHeight: 42)
                                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(on ? Color.green : Color.primary.opacity(0.08)))
                            }
                            .buttonStyle(HVPress())
                            .accessibilityLabel(AutomationRules.fullDayNames[day])
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                }
                field(L("Do this")) {
                    HVListBox {
                        if draft.actions.isEmpty {
                            Text(L("Add at least one thing to do."))
                                .font(.body)
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, minHeight: 50)
                        }
                        ForEach(Array(draft.actions.enumerated()), id: \.offset) { index, action in
                            let text = AutomationRules.describe(action, home: store.home)
                            HStack(spacing: 10) {
                                Text(text).font(.body)
                                Spacer(minLength: 8)
                                Button { _ = draft.actions.remove(at: index) } label: {
                                    Image(systemName: "minus.circle.fill")
                                        .font(.title2)
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .red)
                                }
                                .buttonStyle(HVPress())
                                .accessibilityLabel(L("Remove {name}", ["name": text]))
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 50)
                            if index < draft.actions.count - 1 { Divider().padding(.leading, 14) }
                        }
                    }
                    Menu {
                        addMenu
                    } label: {
                        Label(L("Add"), systemImage: "plus")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Capsule().fill(Color.primary.opacity(0.1)))
                    }
                    .accessibilityLabel(L("Add something to do"))
                }
                if let problem {
                    Text(problem)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.red)
                        .frame(maxWidth: .infinity)
                }
                HStack(spacing: 10) {
                    if !isNew {
                        HVWideButton(title: L("Delete"), symbol: "trash", tint: .red, primary: true) {
                            automations.deleteSchedule(id: draft.id)
                            nav.sheet = nil
                            nav.notify(L("Schedule deleted"), symbol: "calendar", color: .red)
                        }
                    }
                    HVWideButton(title: L("Cancel"), symbol: "xmark") { nav.sheet = nil }
                    HVWideButton(title: L("Save"), symbol: "checkmark", tint: .green, primary: true) { save() }
                }
            }
            .hvCard()
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title.uppercased())
                .font(.footnote.weight(.semibold))
                .tracking(0.6)
                .foregroundStyle(.secondary)
            content()
        }
    }

    /// The time of day as a Date for the picker, stored as minutes after midnight.
    private var time: Binding<Date> {
        Binding(
            get: {
                Calendar.current.date(bySettingHour: draft.minutes / 60, minute: draft.minutes % 60, second: 0, of: Date()) ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                draft.minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
            }
        )
    }

    private func offsetText(_ offset: Int) -> String {
        let sunrise = draft.trigger == .sunrise
        let vars = ["min": String(abs(offset))]
        if offset == 0 { return sunrise ? L("At sunrise") : L("At sunset") }
        if offset < 0 { return sunrise ? L("{min} min before sunrise", vars) : L("{min} min before sunset", vars) }
        return sunrise ? L("{min} min after sunrise", vars) : L("{min} min after sunset", vars)
    }

    private func toggle(_ day: Int) {
        if let i = draft.days.firstIndex(of: day) {
            draft.days.remove(at: i)
        } else {
            draft.days.append(day)
            draft.days.sort()
        }
    }

    private func add(_ action: AutomationAction) {
        draft.actions.append(action)
        problem = nil
    }

    /// Everything a schedule can do, for the Add menu.
    @ViewBuilder
    private var addMenu: some View {
        let home = store.home
        let lightRooms = home.rooms.filter { room in home.lights.contains { $0.roomId == room.id } }
        let shadeRooms = home.rooms.filter { room in home.shades.contains { $0.roomId == room.id } }
        if !home.scenes.isEmpty {
            Section(L("Scenes")) {
                ForEach(home.scenes) { scene in
                    Button(scene.name) { add(.scene(id: scene.id)) }
                }
            }
        }
        if !home.lights.isEmpty {
            Section(L("Lights")) {
                Button(L("Turn all lights off")) { add(.lights(roomId: nil, level: 0)) }
                Button(L("Turn all lights on")) { add(.lights(roomId: nil, level: 1)) }
                ForEach(lightRooms) { room in
                    Menu(room.name) {
                        Button(L("{room} lights off", ["room": room.name])) { add(.lights(roomId: room.id, level: 0)) }
                        Button(L("{room} lights on", ["room": room.name])) { add(.lights(roomId: room.id, level: 1)) }
                        Button(L("{room} lights dim", ["room": room.name])) { add(.lights(roomId: room.id, level: 0.3)) }
                    }
                }
            }
        }
        if !home.shades.isEmpty {
            Section(L("Shades")) {
                Button(L("Open all shades")) { add(.shades(roomId: nil, position: 1)) }
                Button(L("Close all shades")) { add(.shades(roomId: nil, position: 0)) }
                ForEach(shadeRooms) { room in
                    Menu(room.name) {
                        Button(L("Open {room} shades", ["room": room.name])) { add(.shades(roomId: room.id, position: 1)) }
                        Button(L("Close {room} shades", ["room": room.name])) { add(.shades(roomId: room.id, position: 0)) }
                    }
                }
            }
        }
        if !home.media.isEmpty || !home.locks.isEmpty {
            Section(L("Other")) {
                if !home.media.isEmpty {
                    Button(L("Turn off all music and TV")) { add(.mediaOff) }
                }
                if !home.locks.isEmpty {
                    Button(L("Lock all doors")) { add(.lockAll) }
                }
            }
        }
    }

    private func save() {
        var schedule = draft
        schedule.name = schedule.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let message = AutomationRules.validate(schedule) {
            withAnimation { problem = message }
            return
        }
        automations.save(schedule)
        nav.sheet = nil
        nav.notify(L("{name} saved", ["name": schedule.name]), symbol: "calendar", color: .green)
    }
}
