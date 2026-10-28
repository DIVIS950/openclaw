import SwiftUI

struct SceneTile: View {
    @Environment(HomeStore.self) private var store
    let scene: HomeScene

    var body: some View {
        Button {
            store.perform(.recallScene(id: scene.id))
        } label: {
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: Theme.sceneSymbol(scene))
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(scene.isActive ? .black : Theme.scene)
                    .frame(width: 44, height: 44)
                    .background(scene.isActive ? AnyShapeStyle(Theme.scene.gradient) : AnyShapeStyle(.white.opacity(0.08)), in: Circle())
                Text(scene.name)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
            .card()
            .overlay(
                RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                    .strokeBorder(Theme.scene.opacity(scene.isActive ? 0.7 : 0), lineWidth: 1.5)
            )
        }
        .buttonStyle(PressableStyle())
        .sensoryFeedback(.impact(weight: .light), trigger: scene.isActive)
    }
}

struct LightRow: View {
    @Environment(HomeStore.self) private var store
    let light: Light

    var body: some View {
        HStack(spacing: 12) {
            CircleButton(icon: light.isOn ? "lightbulb.fill" : "lightbulb", isOn: light.isOn, tint: Theme.light) {
                store.perform(.setLight(id: light.id, level: light.isOn ? 0 : 1))
            }
            if light.isDimmable {
                LevelSlider(value: light.level, tint: Theme.light, icon: "sun.max.fill", label: light.name) { level in
                    store.perform(.setLight(id: light.id, level: level))
                }
            } else {
                HStack {
                    Text(light.name).font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(light.isOn ? "On" : "Off").foregroundStyle(.secondary)
                }
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.smallCorner, style: .continuous))
                .onTapGesture { store.perform(.setLight(id: light.id, level: light.isOn ? 0 : 1)) }
            }
        }
        .opacity(light.isOnline ? 1 : 0.45)
    }
}

struct ShadeRow: View {
    @Environment(HomeStore.self) private var store
    let shade: Shade

    var body: some View {
        VStack(spacing: 10) {
            if shade.supportsPosition {
                LevelSlider(value: shade.position, tint: Theme.shade, icon: "blinds.horizontal.open", label: shade.name,
                            valueText: { $0 < 0.01 ? "Closed" : $0 > 0.99 ? "Open" : $0.percentText }) { position in
                    store.perform(.setShade(id: shade.id, position: position))
                }
            } else {
                HStack {
                    Label(shade.name, systemImage: "blinds.horizontal.open").font(.subheadline.weight(.semibold))
                    Spacer()
                }
                .padding(.horizontal, 4)
            }
            HStack(spacing: 10) {
                shadeButton("Open", icon: "arrow.up") { store.perform(.setShade(id: shade.id, position: 1)) }
                if shade.supportsStop {
                    shadeButton("Stop", icon: "stop.fill") { store.perform(.stopShade(id: shade.id)) }
                }
                shadeButton("Close", icon: "arrow.down") { store.perform(.setShade(id: shade.id, position: 0)) }
            }
        }
        .opacity(shade.isOnline ? 1 : 0.45)
    }

    private func shadeButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .foregroundStyle(.white)
    }
}

struct LockRow: View {
    @Environment(HomeStore.self) private var store
    let lock: DoorLock
    @State private var confirmUnlock = false

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: lock.isLocked == false ? "lock.open.fill" : "lock.fill")
                .font(.title2)
                .foregroundStyle(lock.isLocked == false ? Theme.alert : Theme.secure)
                .frame(width: 44)
            VStack(alignment: .leading, spacing: 2) {
                Text(lock.name).font(.headline)
                Text(lock.isLocked.map { $0 ? "Locked" : "Unlocked" } ?? "Status unknown")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Button(lock.isLocked == false ? "Lock" : "Unlock") {
                if lock.isLocked == false {
                    store.perform(.setLock(id: lock.id, locked: true))
                } else {
                    confirmUnlock = true
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(lock.isLocked == false ? Theme.secure : .white.opacity(0.2))
        }
        .card()
        .confirmationDialog("Unlock \(lock.name)?", isPresented: $confirmUnlock, titleVisibility: .visible) {
            Button("Unlock", role: .destructive) { store.perform(.setLock(id: lock.id, locked: false)) }
        }
    }
}
