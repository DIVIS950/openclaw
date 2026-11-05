import SwiftUI

/// StandBy for the wall iPad: a big warm clock and the house at a glance, shown when
/// nobody has touched it for a while. It drifts a little every minute so nothing burns
/// into the screen. Any tap wakes it.
@MainActor
struct ScreensaverView: View {
    @Environment(HomeStore.self) private var store
    let onWake: () -> Void

    var body: some View {
        TimelineView(.everyMinute) { context in
            let minute = Int(context.date.timeIntervalSince1970 / 60)
            let dx = CGFloat((minute * 37) % 41 - 20)
            let dy = CGFloat((minute * 23) % 31 - 15)
            VStack(spacing: 18) {
                Text(L10n.longDate(context.date))
                    .textCase(.uppercase)
                    .font(.title3.weight(.semibold))
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.55))
                Text(L10n.time(context.date))
                    .font(.system(size: 240, weight: .thin))
                    .monospacedDigit()
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                    .foregroundStyle(LinearGradient(colors: [Color(red: 1, green: 0.95, blue: 0.89), Color(red: 1, green: 0.72, blue: 0.54), Color(red: 1, green: 0.56, blue: 0.45)],
                                                    startPoint: .top, endPoint: .bottom))
                glance
            }
            .padding(40)
            .offset(x: dx, y: dy)
            .animation(.easeInOut(duration: 4), value: minute)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(Color.black.ignoresSafeArea())
        .contentShape(Rectangle())
        .onTapGesture(perform: onWake)
        .transition(.opacity)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(L("Wakes the screen"))
    }

    private var glance: some View {
        let home = store.home
        return HStack(spacing: 10) {
            pill(home.lightsOnCount == 0 ? L("Lights off") : Ln(home.lightsOnCount, "{n} light on", "{n} lights on"), "lightbulb.fill")
            if !home.locks.isEmpty {
                pill(home.unlockedCount == 0 ? L("Locked") : L("{n} unlocked", ["n": String(home.unlockedCount)]),
                     home.unlockedCount == 0 ? "lock.fill" : "lock.open.fill", attention: home.unlockedCount > 0)
            }
            if home.gates.count > 2 {
                let open = home.gates.filter { $0.state == .open || $0.state == .moving }.count
                pill(open > 0 ? L("Gates: {n} open", ["n": String(open)]) : L("Gates closed"), "door.garage.closed", attention: open > 0)
            } else {
                ForEach(home.gates) { gate in
                    pill("\(gate.name): \(gate.state.label.lowercased())", "door.garage.closed", attention: gate.state == .open)
                }
            }
            if let average = home.averageTemp {
                pill(L10n.temp(average), "thermometer.medium")
            }
            if home.security.count > 1 {
                pill(L("{armed}/{all} armed", ["armed": String(home.armedZoneCount), "all": String(home.security.count)]), "shield.fill",
                     attention: home.security.contains { $0.mode == .alarm })
            } else if let panel = home.security.first {
                pill(panel.mode.label, "shield.fill", attention: panel.mode == .alarm)
            }
        }
    }

    private func pill(_ text: String, _ symbol: String, attention: Bool = false) -> some View {
        Label(text, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(attention ? Color.orange : Color.white.opacity(0.8))
            .padding(.horizontal, 16)
            .padding(.vertical, 9)
            .background(Capsule().fill(Color.white.opacity(0.09)))
    }
}
