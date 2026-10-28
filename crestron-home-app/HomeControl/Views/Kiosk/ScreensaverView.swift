import SwiftUI

/// Dim clock shown on the wall iPad when nobody has touched it for a while.
/// Any tap wakes it.
@MainActor
struct ScreensaverView: View {
    @Environment(HomeStore.self) private var store
    let onWake: () -> Void

    var body: some View {
        TimelineView(.everyMinute) { context in
            VStack(spacing: 10) {
                Spacer()
                Text(context.date, format: .dateTime.hour().minute())
                    .font(.system(size: 120, weight: .thin, design: .rounded))
                    .monospacedDigit()
                Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                    .font(.title2)
                    .foregroundStyle(.secondary)
                Spacer()
                HStack(spacing: 24) {
                    let home = store.home
                    Label("\(home.lightsOnCount) lights on", systemImage: "lightbulb.fill")
                    if let panel = home.security.first {
                        Label(panel.mode.title, systemImage: "shield.fill")
                    }
                    if let gate = home.gates.first {
                        Label("\(gate.name): \(gate.state.title)", systemImage: "door.garage.closed")
                    }
                }
                .font(.headline)
                .foregroundStyle(.secondary)
                .padding(.bottom, 40)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .foregroundStyle(.white.opacity(0.85))
        .background(Color.black.ignoresSafeArea())
        .contentShape(Rectangle())
        .onTapGesture(perform: onWake)
        .transition(.opacity)
    }
}
