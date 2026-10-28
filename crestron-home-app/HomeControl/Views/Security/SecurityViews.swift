import SwiftUI

@MainActor
struct SecurityView: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if !store.home.gates.isEmpty {
                    SectionHeader(title: "Gate")
                    ForEach(store.home.gates) { GateCard(gate: $0) }
                }
                if !store.home.security.isEmpty {
                    SectionHeader(title: "Alarm")
                    ForEach(store.home.security) { SecurityPanelCard(panel: $0) }
                }
                if !store.home.locks.isEmpty {
                    SectionHeader(title: "Doors", trailing: store.home.unlockedCount > 0 ? "\(store.home.unlockedCount) unlocked" : "All locked")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 12)], spacing: 12) {
                        ForEach(store.home.locks) { LockRow(lock: $0) }
                    }
                }
                if store.home.gates.isEmpty && store.home.security.isEmpty && store.home.locks.isEmpty {
                    EmptyState(icon: "shield", title: "No security devices", message: "Gates, alarm panels and door locks show up here.")
                }
            }
            .padding()
        }
        .screenBackground()
        .navigationTitle("Security")
    }
}

@MainActor
struct GateCard: View {
    @Environment(HomeStore.self) private var store
    let gate: Gate
    var compact = false
    @State private var confirm: GateAction?

    private var color: Color {
        switch gate.state {
        case .open: Theme.alert
        case .closed: Theme.secure
        case .moving: Theme.light
        case .unknown: Theme.gate
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: gate.state == .open ? "door.garage.open" : "door.garage.closed")
                    .font(.system(size: compact ? 26 : 34, weight: .semibold))
                    .foregroundStyle(color)
                    .symbolEffect(.pulse, isActive: gate.state == .moving)
                    .frame(width: 52, height: 52)
                    .background(color.opacity(0.15), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(gate.name).font(.headline)
                    Text(gate.state.title).font(.subheadline).foregroundStyle(color)
                }
                Spacer()
            }
            HStack(spacing: 10) {
                if gate.hasSeparateOpenClose {
                    gateButton("Open", icon: "arrow.left.and.right", action: .open, prominent: gate.state != .open)
                    if gate.canStop { gateButton("Stop", icon: "stop.fill", action: .stop, prominent: false) }
                    gateButton("Close", icon: "arrow.right.and.line.vertical.and.arrow.left", action: .close, prominent: gate.state == .open)
                } else {
                    gateButton(gate.state == .open ? "Close Gate" : "Open Gate", icon: "hand.tap.fill", action: .trigger, prominent: true)
                    if gate.canStop { gateButton("Stop", icon: "stop.fill", action: .stop, prominent: false) }
                }
            }
        }
        .card()
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }),
                            titleVisibility: .visible, presenting: confirm) { action in
            Button("Open", role: .destructive) { store.perform(.gate(id: gate.id, action: action)) }
        }
    }

    private var confirmTitle: String { "Open \(gate.name)?" }

    private func gateButton(_ title: String, icon: String, action: GateAction, prominent: Bool) -> some View {
        Button {
            // Opening is the risky one; ask first. Closing and stopping act right away.
            let opens = action == .open || (action == .trigger && gate.state != .open)
            if opens { confirm = action } else { store.perform(.gate(id: gate.id, action: action)) }
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(prominent ? .black : .white)
                .background(prominent ? AnyShapeStyle(Theme.gate.gradient) : AnyShapeStyle(.white.opacity(0.08)),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }
}

@MainActor
struct SecurityPanelCard: View {
    @Environment(HomeStore.self) private var store
    let panel: SecurityPanel
    @State private var pending: SecurityMode?

    private var color: Color {
        switch panel.mode {
        case .disarmed: Theme.shade
        case .armedHome, .armedAway: Theme.secure
        case .alarm: Theme.alert
        case .unknown: .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: panel.mode == .disarmed ? "shield" : panel.mode == .alarm ? "exclamationmark.shield.fill" : "checkmark.shield.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(color)
                    .symbolEffect(.pulse, isActive: panel.mode == .alarm)
                VStack(alignment: .leading, spacing: 2) {
                    Text(panel.name).font(.headline)
                    Text(panel.mode.title).font(.title3.weight(.semibold)).foregroundStyle(color)
                }
                Spacer()
            }
            HStack(spacing: 10) {
                if panel.canArmAway { modeButton("Away", icon: "figure.walk.departure", mode: .armedAway) }
                if panel.canArmHome { modeButton("Home", icon: "house.fill", mode: .armedHome) }
                modeButton("Disarm", icon: "shield.slash", mode: .disarmed)
            }
        }
        .card()
        .sheet(item: $pending) { mode in
            KeypadSheet(title: "\(mode == .disarmed ? "Disarm" : "Arm") \(panel.name)") { code in
                store.perform(.setSecurity(id: panel.id, mode: mode, code: code))
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func modeButton(_ title: String, icon: String, mode: SecurityMode) -> some View {
        let active = panel.mode == mode
        return Button {
            if panel.needsCode { pending = mode } else { store.perform(.setSecurity(id: panel.id, mode: mode, code: nil)) }
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .foregroundStyle(active ? .black : .white)
                .background(active ? AnyShapeStyle(color.gradient) : AnyShapeStyle(.white.opacity(0.08)),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressableStyle())
    }
}

extension SecurityMode: Identifiable {
    var id: String { rawValue }
}

@MainActor
struct KeypadSheet: View {
    @Environment(\.dismiss) private var dismiss
    let title: String
    let onSubmit: (String) -> Void
    @State private var code = ""

    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "delete"]

    var body: some View {
        VStack(spacing: 20) {
            Text(title).font(.title3.weight(.semibold)).padding(.top, 24)
            HStack(spacing: 14) {
                ForEach(0..<max(4, code.count), id: \.self) { i in
                    Circle()
                        .fill(i < code.count ? Color.white : Color.white.opacity(0.15))
                        .frame(width: 14, height: 14)
                }
            }
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(84), spacing: 16), count: 3), spacing: 14) {
                ForEach(keys, id: \.self) { key in
                    Button {
                        switch key {
                        case "clear": code = ""
                        case "delete": if !code.isEmpty { code.removeLast() }
                        default: if code.count < 10 { code.append(key) }
                        }
                    } label: {
                        Group {
                            if key == "clear" { Text("Clear").font(.headline) }
                            else if key == "delete" { Image(systemName: "delete.left").font(.title2) }
                            else { Text(key).font(.title.weight(.medium)) }
                        }
                        .frame(width: 84, height: 64)
                        .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(PressableStyle())
                    .foregroundStyle(.white)
                }
            }
            Button {
                onSubmit(code)
                dismiss()
            } label: {
                Text("Enter").font(.headline).frame(maxWidth: 284, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(Theme.secure)
            .disabled(code.isEmpty)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity)
        .background(Theme.background.ignoresSafeArea())
    }
}
