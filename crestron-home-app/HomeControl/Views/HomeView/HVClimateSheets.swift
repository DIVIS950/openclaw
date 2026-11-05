import SwiftUI

// The cards for one thermostat (a 270° dial with −/+ and presets) and one switch (the sauna).
// Like climateSheet and switchSheet in web/public/ipad/climate.js.

@MainActor
struct HVClimateSheet: View {
    let climate: Climate
    @Environment(HomeStore.self) private var store

    private static let presets: [Double] = [18, 20, 21, 22, 23, 24]

    var body: some View {
        let home = store.home
        let room = home.room(climate.roomId)
        let off = home.heatingOff
        let presets = Self.presets.filter { $0 >= climate.minimum && $0 <= climate.maximum }
        let subtitle = room.map { $0.name != climate.name ? $0.name : L("Heating") } ?? L("Heating")
        let stateText: String = off ? L("Heating is off in the whole house") : climate.isHeating ? L("Heating on") : L("Not heating")
        VStack(spacing: 22) {
            HVSheetHeader(symbol: HVHeatText.climateSymbol(climate), color: climate.isHeating ? HV.heat : HV.cool,
                          title: climate.name, subtitle: subtitle)
            HVClimateDial(climate: climate)
            HStack(spacing: 18) {
                stepButton("minus", label: L("Cooler"), delta: -climate.step)
                Text(stateText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(climate.isHeating && !off ? HV.heat : Color.secondary)
                    .multilineTextAlignment(.center)
                    .frame(width: 170)
                stepButton("plus", label: L("Warmer"), delta: climate.step)
            }
            if !presets.isEmpty {
                HVFlow(spacing: 8) {
                    ForEach(presets, id: \.self) { value in
                        HVPill(title: L10n.temp(value), selected: climate.target == value) {
                            HVAct.setTarget(store, climate, value)
                        }
                    }
                }
            }
        }
        .hvCard()
    }

    private func stepButton(_ symbol: String, label: String, delta: Double) -> some View {
        Button {
            HVAct.setTarget(store, climate, (climate.target ?? climate.current ?? 20) + delta)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.primary)
                .frame(width: 64, height: 64)
                .background(Circle().fill(Color.primary.opacity(0.1)))
                .contentShape(Circle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(label)
    }
}

/// A 270° ring open at the bottom: the colored arc is the target, the white dot the room
/// temperature, with the big target in the middle.
@MainActor
struct HVClimateDial: View {
    let climate: Climate
    @Environment(HomeStore.self) private var store

    private let size: CGFloat = 260
    private let line: CGFloat = 22

    var body: some View {
        let range = Swift.max(0.5, climate.maximum - climate.minimum)
        let setFraction = fraction(climate.target, range: range)
        let nowFraction = fraction(climate.current, range: range)
        let color = climate.isHeating ? HV.heat : HV.cool
        let radius = (size - line) / 2
        let radians = (135 + 270 * nowFraction) * Double.pi / 180
        let markerX = radius * CGFloat(cos(radians))
        let markerY = radius * CGFloat(sin(radians))
        ZStack {
            Circle()
                .trim(from: 0, to: 0.75)
                .stroke(Color.primary.opacity(0.1), style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(135))
            Circle()
                .trim(from: 0, to: CGFloat(0.75 * setFraction))
                .stroke(AngularGradient(colors: [color.opacity(0.55), color], center: .center,
                                        startAngle: .degrees(0), endAngle: .degrees(270)),
                        style: StrokeStyle(lineWidth: line, lineCap: .round))
                .rotationEffect(.degrees(135))
            if climate.current != nil {
                Circle()
                    .fill(Color.white)
                    .frame(width: line - 6, height: line - 6)
                    .overlay(Circle().strokeBorder(Color.black.opacity(0.25), lineWidth: 2))
                    .shadow(color: .black.opacity(0.2), radius: 3, y: 1)
                    .offset(x: markerX, y: markerY)
            }
            VStack(spacing: 4) {
                Text(L("Target"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(L10n.temp(climate.target))
                    .font(.system(size: 52, weight: .bold))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Label(L("Now {t}", ["t": L10n.temp(climate.current)]), systemImage: HVHeatText.climateSymbol(climate))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(climate.isHeating ? HV.heat : Color.secondary)
            }
        }
        .frame(width: size, height: size)
        .animation(.easeOut(duration: 0.25), value: setFraction)
        .animation(.easeOut(duration: 0.6), value: nowFraction)
        .accessibilityElement()
        .accessibilityLabel(L("Target"))
        .accessibilityValue(L10n.temp(climate.target))
        .accessibilityAdjustableAction { direction in
            let base = climate.target ?? climate.current ?? 20
            switch direction {
            case .increment: HVAct.setTarget(store, climate, base + climate.step)
            case .decrement: HVAct.setTarget(store, climate, base - climate.step)
            @unknown default: break
            }
        }
    }

    /// Where a temperature sits between the thermostat's lowest and highest setting, 0...1.
    private func fraction(_ value: Double?, range: Double) -> Double {
        guard let value else { return 0 }
        return Swift.min(1, Swift.max(0, (value - climate.minimum) / range))
    }
}

@MainActor
struct HVSwitchSheet: View {
    let item: HomeSwitch
    @Environment(HomeStore.self) private var store

    var body: some View {
        let room = store.home.room(item.roomId)
        let color: Color = item.isOn ? HVHeatText.switchColor(item) : .gray
        let value = item.current.map { L10n.temp($0) } ?? (item.isOn ? L("On") : L("Off"))
        VStack(spacing: 22) {
            HVSheetHeader(symbol: HVHeatText.switchSymbol(item), color: color, title: item.name,
                          subtitle: room.map { $0.name == item.name ? "" : $0.name })
            Text(value)
                .font(.system(size: 46, weight: .bold))
                .monospacedDigit()
                .contentTransition(.numericText())
                .animation(.snappy, value: value)
            if item.isSauna && item.isOn {
                Text((item.current ?? 0) >= 70 ? L("The sauna is ready") : L("The sauna is heating up"))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Toggle(isOn: Binding(get: { item.isOn }, set: { store.perform(.setSwitch(id: item.id, on: $0)) })) {
                Label(item.name, systemImage: HVHeatText.switchSymbol(item)).font(.body.weight(.semibold))
            }
            .tint(.green)
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.07)))
            .frame(maxWidth: 380)
            if item.isOn {
                HVTimerPills(verb: L("Turn off"), label: L("{name} off", ["name": item.name]), command: .setSwitch(id: item.id, on: false))
            }
        }
        .hvCard()
    }
}
