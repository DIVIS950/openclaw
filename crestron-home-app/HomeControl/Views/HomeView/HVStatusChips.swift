import SwiftUI

// The status capsules at the top of Home: lights, heating, alarm zones, doors, gates,
// shades and media at a glance. Like chips() in web/public/ipad/views.js.

@MainActor
struct HVStatusChips: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let unlocked = home.unlockedCount
        let playing = home.media.filter(\.isOn).count
        let open = home.shades.filter { $0.position > 0.02 }.count
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                if !home.lights.isEmpty {
                    chip("lightbulb.fill", HV.light, L("Lights"), home.lightsOnCount == 0 ? L("All off") : L("{n} on", ["n": String(home.lightsOnCount)])) { nav.go(.lights) }
                }
                if let average = home.averageTemp {
                    let heatColor: Color = home.heatingOff ? .gray : HV.heat
                    chip("thermometer.medium", heatColor, L("Heating"), L10n.temp(average)) { nav.go(.heating) }
                }
                if home.security.count > 1 {
                    let armed = home.armedZoneCount
                    let alarm = home.security.contains { $0.mode == .alarm }
                    let symbol = alarm ? "exclamationmark.shield.fill" : (armed > 0 ? "checkmark.shield.fill" : "shield")
                    let color: Color = alarm ? .red : (armed > 0 ? .indigo : .gray)
                    let value = alarm ? L("Alarm") : L("{armed}/{all} armed", ["armed": String(armed), "all": String(home.security.count)])
                    chip(symbol, color, L("Security"), value, attention: alarm) { nav.go(.security) }
                } else if let panel = home.security.first {
                    chip("shield.fill", HV.alarmColor(panel.mode), L("Security"), panel.mode.label, attention: panel.mode == .alarm) { nav.go(.security) }
                }
                if !home.locks.isEmpty {
                    chip(unlocked > 0 ? "lock.open.fill" : "lock.fill", unlocked > 0 ? .orange : .green, L("Doors"),
                         unlocked > 0 ? L("{n} unlocked", ["n": String(unlocked)]) : L("Locked"), attention: unlocked > 0) { nav.go(.security) }
                }
                if home.gates.count > 2 {
                    let openGates = home.gates.filter { $0.state != .closed && $0.state != .unknown }.count
                    chip("door.garage.closed", HV.gate, L("Gates"), openGates > 0 ? L("{n} open", ["n": String(openGates)]) : L("Closed"),
                         attention: openGates > 0) { nav.go(.security) }
                } else {
                    ForEach(home.gates) { gate in
                        chip("door.garage.closed", HV.gate, gate.name, gate.state.label, attention: gate.state == .open) { nav.go(.security) }
                    }
                }
                if !home.shades.isEmpty {
                    chip("blinds.horizontal.closed", HV.shade, L("Shades"), open == 0 ? L("Closed") : L("{n} open", ["n": String(open)])) { nav.go(.shades) }
                }
                if !home.media.isEmpty {
                    chip("music.note", HV.media, L("Media"), playing == 0 ? L("Off") : L("{n} playing", ["n": String(playing)])) { nav.go(.media) }
                }
            }
            .padding(.vertical, 4)
        }
        .scrollIndicators(.hidden)
    }

    private func chip(_ symbol: String, _ color: Color, _ title: String, _ value: String, attention: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(color))
                VStack(alignment: .leading, spacing: 0) {
                    Text(title).font(.footnote.weight(.semibold))
                    Text(value).font(.footnote.weight(attention ? .semibold : .medium))
                        .foregroundStyle(attention ? Color.orange : Color.secondary)
                        .monospacedDigit()
                }
                .lineLimit(1)
            }
            .foregroundStyle(.primary)
            .padding(.leading, 7)
            .padding(.trailing, 18)
            .padding(.vertical, 7)
            .hvGlass(30)
        }
        .buttonStyle(HVPress())
        .accessibilityLabel("\(title), \(value)")
    }
}
