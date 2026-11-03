import SwiftUI

// Houses with several alarm zones or gates get one card for all of them instead of one
// widget each: the zones card (one tap arms or disarms a zone) and the arrival card (every
// gate, each still slide-to-open). Like zonesWidget and arrivalWidget in web/public/ipad/climate.js.

/// All alarm zones in one card (Dům, Garáž, Klub, Sauna).
@MainActor
struct HVZonesWidget: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let zones = store.home.security
        let armed = zones.filter(\.mode.isArmed).count
        let alarm = zones.contains { $0.mode == .alarm }
        let color: Color = alarm ? .red : (armed > 0 ? .indigo : .gray)
        let symbol = alarm ? "exclamationmark.shield.fill" : (armed > 0 ? "checkmark.shield.fill" : "shield")
        let state: String = alarm ? L("Alarm") : (armed > 0 ? Ln(armed, "{n} zone armed", "{n} zones armed") : L("Disarmed"))
        VStack(alignment: .leading, spacing: 14) {
            HVWidgetTop(symbol: symbol, color: color, name: L("Security zones"), state: state, stateColor: alarm ? .red : nil)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                ForEach(zones) { zoneButton($0) }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .hvGlass(HV.widgetRadius)
    }

    private func zoneButton(_ zone: SecurityPanel) -> some View {
        let on = zone.mode.isArmed
        let alarm = zone.mode == .alarm
        let next: SecurityMode = on || alarm ? .disarmed : (zone.canArmAway ? .armedAway : .armedHome)
        let tint: Color = alarm ? .red : .indigo
        let symbol = on ? "lock.fill" : (alarm ? "exclamationmark.shield.fill" : "lock.open.fill")
        return Button { arm(zone, next) } label: {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(on || alarm ? Color.white : Color.secondary)
                    .frame(width: 38, height: 38)
                    .background(Circle().fill(on || alarm ? tint : Color.primary.opacity(0.08)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(zone.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(zone.mode.label)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(alarm ? Color.red : Color.secondary)
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.primary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(on ? Color.white.opacity(0.96) : Color.primary.opacity(0.06)))
            .environment(\.colorScheme, on ? .light : scheme)
            .contentShape(Rectangle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel("\(zone.name): \(zone.mode.label). \(on || alarm ? L("Disarm") : L("Arm"))")
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func arm(_ zone: SecurityPanel, _ mode: SecurityMode) {
        HVAct.arm(store, nav, zone, mode)
        // Zones with a code open the keypad instead; the keypad confirms by itself.
        if !zone.needsCode {
            nav.notify("\(zone.name): \(mode.label)", symbol: mode == .disarmed ? "lock.open.fill" : "lock.fill", color: .indigo)
        }
    }
}

/// Every gate in one card. Opening still needs a full slide, so a stray tap never opens one.
@MainActor
struct HVArrivalWidget: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let gates = store.home.gates
        let open = gates.filter { $0.state == .open || $0.state == .moving }.count
        VStack(alignment: .leading, spacing: 14) {
            HVWidgetTop(symbol: open > 0 ? "door.garage.open" : "door.garage.closed", color: HV.gate, name: L("Arrival"),
                        state: open > 0 ? Ln(open, "{n} open", "{n} open") : L("All closed"), stateColor: open > 0 ? .orange : nil)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 250), spacing: 12, alignment: .top)], spacing: 12) {
                ForEach(gates) { gate in
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(gate.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(gate.state.label)
                                    .font(.footnote.weight(.medium))
                                    .foregroundStyle(gate.state == .open ? Color.orange : Color.secondary)
                            }
                            Spacer(minLength: 0)
                            HVMoreButton(label: L("{name} controls", ["name": gate.name])) { nav.sheet = .gate(gate.id) }
                        }
                        HVGateControls(gate: gate)
                    }
                    .padding(12)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.primary.opacity(0.05)))
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .hvGlass(HV.widgetRadius)
    }
}
