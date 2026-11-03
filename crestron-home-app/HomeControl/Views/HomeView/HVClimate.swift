import SwiftUI

// Heating (Topení): thermostat and switch tiles, the heating mode and sauna widgets, the
// small heating widget for Home, and the Heating page. Like web/public/ipad/climate.js.
// The thermostat and switch cards are in HVClimateSheets.swift.

extension HV {
    static let heat = Color.orange
    static let cool = Color.teal
}

/// Words and symbols for heating, shared by tiles, widgets and cards.
enum HVHeatText {
    /// Like Apple Home: the room temperature, and where it is heading while it heats.
    static func climateState(_ climate: Climate) -> String {
        if !climate.isOnline { return L("No response") }
        if climate.isHeating, let target = climate.target {
            return "\(L10n.temp(climate.current)) → \(L10n.temp(target))"
        }
        return L10n.temp(climate.current)
    }

    static func climateSymbol(_ climate: Climate) -> String {
        climate.isHeating ? "flame.fill" : "thermometer.medium"
    }

    static func switchState(_ item: HomeSwitch) -> String {
        let base = item.isOn ? L("On") : L("Off")
        guard let current = item.current else { return base }
        return "\(base) · \(L10n.temp(current))"
    }

    static func switchSymbol(_ item: HomeSwitch) -> String {
        switch item.kind {
        case "sauna": return "heater.vertical.fill"
        case "motion": return "figure.walk.motion"
        case "heating": return "flame.fill"
        default: return "power"
        }
    }

    static func switchColor(_ item: HomeSwitch) -> Color {
        item.isSauna ? HV.heat : .green
    }
}

@MainActor
extension HVAct {
    static func toggleSwitch(_ store: HomeStore, _ nav: HVNav, _ item: HomeSwitch) {
        let on = !item.isOn
        store.perform(.setSwitch(id: item.id, on: on))
        let text = on ? L("{name} on", ["name": item.name]) : L("{name} off", ["name": item.name])
        nav.notify(text, symbol: HVHeatText.switchSymbol(item), color: HV.heat)
    }

    /// Sets a thermostat, kept inside its range and on its step. Nothing is sent when it wouldn't change.
    static func setTarget(_ store: HomeStore, _ climate: Climate, _ value: Double) {
        let next = climate.clampTarget(value)
        guard next != climate.target else { return }
        store.perform(.setClimate(id: climate.id, target: next))
    }

    static func setMode(_ store: HomeStore, _ nav: HVNav, _ mode: HomeMode, _ option: ModeOption) {
        guard mode.value != option.id else { return }
        store.perform(.setMode(id: mode.id, value: option.id))
        nav.notify("\(mode.name): \(option.name)", symbol: "flame.fill", color: HV.heat)
    }
}

// MARK: - Tiles

@MainActor
struct HVClimateTile: View {
    let climate: Climate
    /// On the Heating page the tile names its room; inside a room it says "Temperature".
    var showRoom = false
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let room = store.home.room(climate.roomId)
        // A thermostat is usually named after its room; then the room name alone is enough.
        let same = room?.name == climate.name
        let name = same ? (showRoom ? climate.name : L("Temperature")) : climate.name
        let roomText: String? = showRoom && !same ? room?.name : nil
        let color: Color = climate.isHeating ? HV.heat : HV.cool
        let toggleLabel = L("{name} heating controls", ["name": climate.name])
        // A thermostat has no on/off: its icon opens the temperature card too.
        HVTile(symbol: HVHeatText.climateSymbol(climate), name: name, state: HVHeatText.climateState(climate),
               color: color, isOn: climate.isHeating, room: roomText,
               offline: !climate.isOnline, pulse: store.pulse("climate:\(climate.id)"),
               toggleLabel: toggleLabel,
               onToggle: { nav.sheet = .climate(climate.id) }, onOpen: { nav.sheet = .climate(climate.id) })
    }
}

@MainActor
struct HVSwitchTile: View {
    let item: HomeSwitch
    var room: String?
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let toggleLabel = item.isOn ? L("Turn off {name}", ["name": item.name]) : L("Turn on {name}", ["name": item.name])
        HVTile(symbol: HVHeatText.switchSymbol(item), name: item.name, state: HVHeatText.switchState(item),
               color: HVHeatText.switchColor(item), isOn: item.isOn, room: room, pulse: store.pulse("switch:\(item.id)"),
               toggleLabel: toggleLabel,
               onToggle: { HVAct.toggleSwitch(store, nav, item) }, onOpen: { nav.sheet = .homeSwitch(item.id) })
    }
}

// MARK: - Widgets

/// A temperature on the right of a widget's top row.
private struct HVWidgetTemp: View {
    let value: Double

    var body: some View {
        Text(L10n.temp(value))
            .font(.title3.weight(.bold))
            .monospacedDigit()
            .foregroundStyle(.secondary)
            .contentTransition(.numericText())
            .accessibilityLabel(L("Average {t}", ["t": L10n.temp(value)]))
    }
}

/// The house heating mode: Zapnuto / Individuální / Útlum / Vypnuto.
@MainActor
struct HVModeWidget: View {
    let mode: HomeMode
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let off = mode.value == "off"
        let heatingRooms = home.climate.filter(\.isHeating).count
        let note: String = off ? L("Heating is off in the whole house")
            : heatingRooms > 0 ? Ln(heatingRooms, "{n} room heating", "{n} rooms heating") : L("All rooms are warm")
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                HVWidgetTop(symbol: off ? "thermometer.medium" : "flame.fill", color: off ? .gray : HV.heat,
                            name: mode.name, state: mode.current?.name ?? "–")
                if let average = home.averageTemp { HVWidgetTemp(value: average) }
            }
            Text(note).font(.footnote.weight(.medium)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                ForEach(mode.options) { segment($0) }
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 17, style: .continuous).fill(Color.primary.opacity(0.07)))
        }
        .hvWidget()
    }

    private func segment(_ option: ModeOption) -> some View {
        let selected = mode.value == option.id
        let tint: Color = option.id == "off" ? .gray : HV.heat
        return Button { HVAct.setMode(store, nav, mode, option) } label: {
            Text(option.name)
                .font(.footnote.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.65)
                .foregroundStyle(selected ? tint : Color.primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .padding(.horizontal, 2)
                .background {
                    if selected {
                        RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white).shadow(color: .black.opacity(0.1), radius: 4, y: 2)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel("\(mode.name): \(option.name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// The sauna: its temperature, how far it has warmed up, and a big on/off button.
@MainActor
struct HVSaunaWidget: View {
    let sauna: HomeSwitch
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let warm = (sauna.current ?? 0) >= 70
        let state = sauna.isOn ? (warm ? L("Ready") : L("Heating up")) : L("Off")
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 8) {
                HVWidgetTop(symbol: HVHeatText.switchSymbol(sauna), color: sauna.isOn ? HV.heat : .gray, name: sauna.name, state: state)
                if let current = sauna.current {
                    Text(L10n.temp(current))
                        .font(.title3.weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(sauna.isOn ? HV.heat : Color.secondary)
                        .contentTransition(.numericText())
                }
            }
            if sauna.isOn { warmth }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                HVWideButton(title: sauna.isOn ? L("Turn off") : L("Turn on"), symbol: "power", tint: HV.heat, primary: !sauna.isOn) {
                    HVAct.toggleSwitch(store, nav, sauna)
                }
                HVMoreButton(label: L("More controls")) { nav.sheet = .homeSwitch(sauna.id) }
            }
        }
        .hvWidget()
    }

    /// 20 °C (empty) to 85 °C (full).
    private var warmth: some View {
        let fraction = Swift.min(1, Swift.max(0.04, ((sauna.current ?? 20) - 20) / 65))
        return GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.1))
                Capsule()
                    .fill(LinearGradient(colors: [.yellow, .orange, .red], startPoint: .leading, endPoint: .trailing))
                    .frame(width: geo.size.width * CGFloat(fraction))
            }
        }
        .frame(height: 8)
        .animation(.easeOut(duration: 0.6), value: fraction)
        .accessibilityHidden(true)
    }
}

/// Small Home widget: the average temperature, the house mode and the sauna.
@MainActor
struct HVHeatingSummaryWidget: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let mode = home.heatingMode
        let sauna = home.sauna
        let average = home.averageTemp
        if mode != nil || sauna != nil || average != nil {
            VStack(alignment: .leading, spacing: 10) {
                HVWidgetTop(symbol: "thermometer.medium", color: home.heatingOff ? .gray : HV.heat, name: L("Heating"),
                            state: average.map { L10n.temp($0) } ?? (mode?.current?.name ?? ""), more: { nav.go(.heating) })
                Spacer(minLength: 0)
                if let mode {
                    row(symbol: "flame.fill", title: mode.name, value: mode.current?.name ?? "–", on: !home.heatingOff) { nav.go(.heating) }
                }
                if let sauna {
                    row(symbol: HVHeatText.switchSymbol(sauna), title: sauna.name, value: HVHeatText.switchState(sauna), on: sauna.isOn) {
                        HVAct.toggleSwitch(store, nav, sauna)
                    }
                }
            }
            .hvWidget()
        }
    }

    private func row(symbol: String, title: String, value: String, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(on ? HV.heat : Color.secondary)
                    .frame(width: 22)
                Text(title).font(.subheadline.weight(.medium)).lineLimit(1)
                Spacer(minLength: 6)
                Text(value).font(.subheadline.weight(.bold)).monospacedDigit().lineLimit(1)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(on ? HV.heat.opacity(0.16) : Color.primary.opacity(0.07)))
            .contentShape(Rectangle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel("\(title), \(value)")
    }
}

// MARK: - The Heating page

@MainActor
struct HVHeatingPage: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        let average = home.averageTemp
        let mode = home.heatingMode
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: L("Heating"), title: average.map { L10n.temp($0) } ?? L("Heating"),
                     subtitle: mode.map { "\($0.name): \($0.current?.name ?? "")" })
            HVHeatingBody()
        }
    }
}

/// The Heating page without its header (also the Heating page of Home): the mode and the
/// sauna, then thermostats grouped by floor, then other switches.
@MainActor
struct HVHeatingBody: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        let saunas = home.switches.filter(\.isSauna)
        let others = home.switches.filter { !$0.isSauna }
        let loose = home.climate.filter { home.knownRoomId($0.roomId) == nil }
        VStack(alignment: .leading, spacing: 28) {
            if home.heatingOff {
                Label(L("Heating is off in the whole house"), systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.orange.opacity(0.18)))
            }
            if !home.modes.isEmpty || !saunas.isEmpty {
                LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                    ForEach(home.modes) { HVModeWidget(mode: $0) }
                    ForEach(saunas) { HVSaunaWidget(sauna: $0) }
                }
            }
            ForEach(home.floors) { floor in
                let list = floor.rooms.flatMap { home.climate(in: $0.id) }
                if !list.isEmpty {
                    HVSection(title: floor.name.isEmpty ? L("Other") : floor.name) {
                        LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                            ForEach(list) { HVClimateTile(climate: $0, showRoom: true) }
                        }
                    }
                }
            }
            if !loose.isEmpty {
                HVSection(title: L("Other")) {
                    LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                        ForEach(loose) { HVClimateTile(climate: $0) }
                    }
                }
            }
            if !others.isEmpty {
                HVSection(title: L("Switches")) {
                    LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                        ForEach(others) { HVSwitchTile(item: $0, room: home.room($0.roomId)?.name) }
                    }
                }
            }
            if home.climate.isEmpty && home.modes.isEmpty && home.switches.isEmpty {
                ContentUnavailableView(L("No heating"), systemImage: "thermometer.medium")
            }
        }
    }
}
