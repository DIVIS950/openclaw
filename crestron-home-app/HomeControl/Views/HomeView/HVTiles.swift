import SwiftUI

/// Small actions shared by tiles, widgets and sheets, with the notice that confirms them.
@MainActor
enum HVAct {
    static func gate(_ store: HomeStore, _ nav: HVNav, _ gate: Gate, _ action: GateAction) {
        let opens = action == .open || (action == .trigger && gate.state != .open)
        store.perform(.gate(id: gate.id, action: action))
        if action == .stop {
            nav.notify("\(gate.name) stopped", symbol: "stop.fill", color: .blue)
        } else {
            nav.notify("\(opens ? "Opening" : "Closing") \(gate.name)", symbol: "door.garage.open", color: .blue)
        }
    }

    static func arm(_ store: HomeStore, _ nav: HVNav, _ panel: SecurityPanel, _ mode: SecurityMode) {
        guard panel.mode != mode else { return }
        if panel.needsCode {
            nav.sheet = .keypad(panelId: panel.id, mode: mode)
        } else {
            store.perform(.setSecurity(id: panel.id, mode: mode, code: nil))
        }
    }

    /// Locking is one tap; unlocking always goes through press-and-hold.
    static func lockTapped(_ store: HomeStore, _ nav: HVNav, _ lock: DoorLock) {
        if lock.isLocked == false {
            store.perform(.setLock(id: lock.id, locked: true))
            nav.notify("\(lock.name) locked", symbol: "lock.fill")
        } else {
            nav.sheet = .lock(lock.id)
        }
    }

    static func scene(_ store: HomeStore, _ nav: HVNav, _ scene: HomeScene) {
        store.perform(.recallScene(id: scene.id))
        nav.notify("\(scene.name) is on", symbol: Theme.sceneSymbol(scene), color: .orange)
    }
}

extension HomeSnapshot {
    /// Media rooms are usually named after their room; on a tile call them TV or Speakers instead.
    func tileName(_ zone: MediaZone) -> String {
        guard room(zone.roomId)?.name == zone.name else { return zone.name }
        let names = zone.sources.map(\.name).joined(separator: " ").lowercased()
        return ["tv", "cable", "apple"].contains { names.contains($0) } ? "TV" : "Speakers"
    }
}

enum HVText {
    static func light(_ light: Light) -> String {
        if !light.isOnline { return "No response" }
        if !light.isOn { return "Off" }
        return light.isDimmable ? light.level.percentText : "On"
    }

    static func shade(_ position: Double) -> String {
        if position >= 0.98 { return "Open" }
        if position <= 0.02 { return "Closed" }
        return "\(position.percentText) open"
    }

    static func lock(_ lock: DoorLock) -> String {
        switch lock.isLocked {
        case .some(true): "Locked"
        case .some(false): "Unlocked"
        case .none: "Unknown"
        }
    }
}

// MARK: - Tiles

/// One accessory, Apple Home style: tap the icon to switch it, tap the name for more.
@MainActor
struct HVTile: View {
    let symbol: String
    let name: String
    let state: String
    let color: Color
    let isOn: Bool
    var room: String?
    var warn = false
    var offline = false
    /// Brightness, shown as a soft wash across the tile.
    var level: Double?
    let toggleLabel: String
    let onToggle: () -> Void
    let onOpen: () -> Void
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: symbol)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(isOn ? Color.white : Color.secondary)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(isOn ? color : Color.primary.opacity(0.08)))
                    .shadow(color: isOn ? color.opacity(0.45) : .clear, radius: 8, y: 4)
                    .contentShape(Circle())
            }
            .buttonStyle(HVPress())
            .accessibilityLabel(toggleLabel)

            Button(action: onOpen) {
                VStack(alignment: .leading, spacing: 1) {
                    if let room {
                        Text(room).font(.caption.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Text(name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(state)
                        .font(.footnote.weight(warn ? .semibold : .medium))
                        .foregroundStyle(warn ? Color.orange : Color.secondary)
                        .monospacedDigit()
                        .contentTransition(.numericText())
                        .lineLimit(1)
                }
                .foregroundStyle(.primary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(name), \(state)")
            .accessibilityHint("Shows more controls")
        }
        .padding(12)
        .frame(minHeight: 76)
        .background { background }
        .environment(\.colorScheme, isOn ? .light : scheme)
        .opacity(offline ? 0.55 : 1)
        .animation(.easeOut(duration: 0.25), value: isOn)
    }

    @ViewBuilder
    private var background: some View {
        let shape = RoundedRectangle(cornerRadius: HV.tileRadius, style: .continuous)
        if isOn {
            shape.fill(Color.white.opacity(0.96))
                .overlay(alignment: .leading) {
                    if let level {
                        GeometryReader { geo in
                            Rectangle().fill(HV.light.opacity(0.15)).frame(width: geo.size.width * level)
                        }
                        .clipShape(shape)
                    }
                }
                .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
        } else {
            Color.clear.hvGlass()
        }
    }
}

@MainActor
struct HVSceneTile: View {
    let scene: HomeScene
    let color: Color
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav
    @Environment(\.colorScheme) private var scheme
    @State private var runs = 0

    var body: some View {
        Button {
            runs += 1
            HVAct.scene(store, nav, scene)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: Theme.sceneSymbol(scene))
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(color))
                    .symbolEffect(.bounce, value: runs)
                VStack(alignment: .leading, spacing: 1) {
                    Text(scene.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(scene.isActive ? "Active" : "Scene").font(.footnote.weight(.medium)).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(.primary)
            .padding(12)
            .frame(minHeight: 76)
            .background {
                let shape = RoundedRectangle(cornerRadius: HV.tileRadius, style: .continuous)
                if scene.isActive {
                    shape.fill(Color.white.opacity(0.96))
                        .overlay(shape.strokeBorder(color.opacity(0.6), lineWidth: 2))
                        .shadow(color: .black.opacity(0.12), radius: 16, y: 8)
                } else {
                    Color.clear.hvGlass()
                }
            }
            .environment(\.colorScheme, scene.isActive ? .light : scheme)
        }
        .buttonStyle(HVPress())
        .sensoryFeedback(.success, trigger: runs)
        .accessibilityLabel("\(scene.name) scene\(scene.isActive ? ", active" : "")")
    }
}

/// The lights, shades, media rooms and locks given, as tiles.
@MainActor
struct HVAccessoryGrid: View {
    var lights: [Light] = []
    var shades: [Shade] = []
    var media: [MediaZone] = []
    var locks: [DoorLock] = []
    var showRoom = false
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let roomName = { (id: String?) in showRoom ? home.room(id)?.name : nil }
        LazyVGrid(columns: HV.tileColumns, spacing: 12) {
            ForEach(lights) { light in
                HVTile(symbol: light.isOn ? "lightbulb.fill" : "lightbulb", name: light.name, state: HVText.light(light),
                       color: HV.light, isOn: light.isOn, room: roomName(light.roomId), offline: !light.isOnline,
                       level: light.isDimmable ? light.level : nil, toggleLabel: "\(light.name): turn \(light.isOn ? "off" : "on")",
                       onToggle: { store.toggle(light: light.id) }, onOpen: { nav.sheet = .light(light.id) })
            }
            ForEach(shades) { shade in
                let open = shade.position > 0.02
                HVTile(symbol: open ? "blinds.horizontal.open" : "blinds.horizontal.closed", name: shade.name, state: HVText.shade(shade.position),
                       color: HV.shade, isOn: open, room: roomName(shade.roomId), offline: !shade.isOnline,
                       toggleLabel: "\(shade.name): \(open ? "close" : "open")",
                       onToggle: { store.perform(.setShade(id: shade.id, position: open ? 0 : 1)) }, onOpen: { nav.sheet = .shade(shade.id) })
            }
            ForEach(media) { zone in
                let state = zone.isOn ? "\(zone.currentSource?.name ?? "On")\(zone.hasVolume ? " · \(zone.isMuted ? "Muted" : zone.volume.percentText)" : "")" : "Off"
                HVTile(symbol: HV.symbol(for: zone), name: home.tileName(zone), state: state, color: HV.media, isOn: zone.isOn,
                       room: roomName(zone.roomId), toggleLabel: "\(zone.name): turn \(zone.isOn ? "off" : "on")",
                       onToggle: { store.perform(.mediaPower(zoneId: zone.id, on: !zone.isOn)) }, onOpen: { nav.sheet = .media(zone.id) })
            }
            ForEach(locks) { lock in
                let unlocked = lock.isLocked == false
                HVTile(symbol: unlocked ? "lock.open.fill" : "lock.fill", name: lock.name, state: HVText.lock(lock),
                       color: unlocked ? .orange : .green, isOn: lock.isLocked != nil, room: roomName(lock.roomId), warn: unlocked,
                       toggleLabel: unlocked ? "Lock \(lock.name)" : "Unlock \(lock.name)",
                       onToggle: { HVAct.lockTapped(store, nav, lock) }, onOpen: { nav.sheet = .lock(lock.id) })
            }
        }
    }
}

extension HV {
    static let tileColumns = [GridItem(.adaptive(minimum: 184), spacing: 12)]
    static let widgetColumns = [GridItem(.adaptive(minimum: 258), spacing: 14, alignment: .top)]
}

@MainActor
struct HVSection<Content: View>: View {
    let title: String
    var open: (() -> Void)?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let open {
                Button(action: open) {
                    HStack(spacing: 3) {
                        Text(title)
                        Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
                .font(.title3.weight(.bold))
                .accessibilityHint("Opens the room")
            } else {
                Text(title).font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
            }
            content
        }
    }
}

// MARK: - Status capsules

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
                    chip("lightbulb.fill", HV.light, "Lights", home.lightsOnCount == 0 ? "All off" : "\(home.lightsOnCount) on") { nav.go(.lights) }
                }
                if let panel = home.security.first {
                    chip("shield.fill", HV.alarmColor(panel.mode), "Security", panel.mode.title, attention: panel.mode == .alarm) { nav.go(.security) }
                }
                if !home.locks.isEmpty {
                    chip(unlocked > 0 ? "lock.open.fill" : "lock.fill", unlocked > 0 ? .orange : .green, "Doors",
                         unlocked > 0 ? "\(unlocked) unlocked" : "Locked", attention: unlocked > 0) { nav.go(.security) }
                }
                ForEach(home.gates) { gate in
                    chip("door.garage.closed", HV.gate, gate.name, gate.state.title, attention: gate.state == .open) { nav.go(.security) }
                }
                if !home.shades.isEmpty {
                    chip("blinds.horizontal.closed", HV.shade, "Shades", open == 0 ? "Closed" : "\(open) open") { nav.go(.shades) }
                }
                if !home.media.isEmpty {
                    chip("music.note", HV.media, "Media", playing == 0 ? "Off" : "\(playing) playing") { nav.go(.media) }
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

// MARK: - Widgets

@MainActor
struct HVWidgetTop: View {
    let symbol: String
    let color: Color
    let name: String
    let state: String
    var stateColor: Color?
    var more: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(color))
                .shadow(color: color.opacity(0.4), radius: 8, y: 4)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                Text(state).font(.title3.weight(.bold)).foregroundStyle(stateColor ?? .primary).lineLimit(1)
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
            if let more { HVMoreButton(label: "\(name) controls", action: more) }
        }
    }
}

struct HVMoreButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.secondary)
                .frame(width: 34, height: 34)
                .background(Circle().fill(Color.primary.opacity(0.08)))
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(label)
    }
}

struct HVWideButton: View {
    let title: String
    let symbol: String
    var tint: Color = .blue
    var primary = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .frame(maxWidth: .infinity, minHeight: 46)
                .foregroundStyle(primary ? Color.white : Color.primary)
                .background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(primary ? tint : Color.primary.opacity(0.08)))
        }
        .buttonStyle(HVPress())
    }
}

private extension View {
    func hvWidget() -> some View {
        padding(18)
            .frame(maxWidth: .infinity, minHeight: 184, alignment: .topLeading)
            .hvGlass(HV.widgetRadius)
    }
}

@MainActor
struct HVGateWidget: View {
    let gate: Gate
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HVWidgetTop(symbol: gate.state == .open ? "door.garage.open" : "door.garage.closed", color: HV.gate, name: gate.name,
                        state: gate.state.title, more: { nav.sheet = .gate(gate.id) })
            Spacer(minLength: 0)
            HVGateControls(gate: gate)
        }
        .hvWidget()
    }
}

@MainActor
struct HVGateControls: View {
    let gate: Gate
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let openAction: GateAction = gate.hasSeparateOpenClose ? .open : .trigger
        switch gate.state {
        case .moving:
            VStack(spacing: 10) {
                HVMovingBar(tint: HV.gate)
                if gate.canStop {
                    HVWideButton(title: "Stop", symbol: "stop.fill") { HVAct.gate(store, nav, gate, .stop) }
                }
            }
        case .open:
            HVWideButton(title: "Close \(gate.name)", symbol: "arrow.right.and.line.vertical.and.arrow.left", tint: HV.gate, primary: true) {
                HVAct.gate(store, nav, gate, gate.hasSeparateOpenClose ? .close : .trigger)
            }
        case .closed, .unknown:
            // Opening is a deliberate slide all the way across, so a stray tap never opens the gate.
            HVSlideToOpen(tint: HV.gate, label: "slide to open", accessibilityName: "Open \(gate.name)") {
                HVAct.gate(store, nav, gate, openAction)
            } onAccessibilityOpen: {
                nav.sheet = .confirmGate(gate.id, openAction)
            }
            .id(gate.state)
        }
    }
}

@MainActor
struct HVSecurityWidget: View {
    let panel: SecurityPanel
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HVWidgetTop(symbol: panel.mode == .disarmed ? "shield" : panel.mode == .alarm ? "exclamationmark.shield.fill" : "checkmark.shield.fill",
                        color: HV.alarmColor(panel.mode), name: panel.name, state: panel.mode.title, stateColor: panel.mode == .alarm ? .red : nil)
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                if panel.canArmAway { segment("Away", "figure.walk.departure", .armedAway) }
                if panel.canArmHome { segment("Home", "house.fill", .armedHome) }
                segment("Off", "shield", .disarmed)
            }
            .padding(4)
            .background(RoundedRectangle(cornerRadius: 17, style: .continuous).fill(Color.primary.opacity(0.07)))
        }
        .hvWidget()
    }

    private func segment(_ title: String, _ symbol: String, _ mode: SecurityMode) -> some View {
        let selected = panel.mode == mode
        return Button { HVAct.arm(store, nav, panel, mode) } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
                Text(title).font(.footnote.weight(.semibold))
            }
            .foregroundStyle(selected ? HV.alarmColor(mode) : Color.primary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white).shadow(color: .black.opacity(0.1), radius: 4, y: 2)
                }
            }
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(mode == .disarmed ? "Disarm" : "Arm \(title.lowercased())")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

@MainActor
struct HVZoneWidget: View {
    let zone: MediaZone
    var others: [MediaZone] = []
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let room = home.room(zone.roomId)?.name ?? zone.name
        VStack(alignment: .leading, spacing: 14) {
            if zone.isOn {
                HStack(spacing: 14) {
                    HVArtwork(source: zone.currentSource?.name ?? "", symbol: HV.symbol(for: zone))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(zone.currentSource?.name ?? "On").font(.title3.weight(.bold)).lineLimit(1)
                        HStack(spacing: 6) {
                            Text(room).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).lineLimit(1)
                            if zone.isMuted {
                                Text("· Muted").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                            } else {
                                HVEqualizer()
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    HVMoreButton(label: "\(zone.name) controls") { nav.sheet = .media(zone.id) }
                }
                Spacer(minLength: 0)
                if zone.hasVolume { HVVolumeBar(zone: zone) }
                if !others.isEmpty {
                    Button("Also playing in \(others.map { home.room($0.roomId)?.name ?? $0.name }.joined(separator: ", "))") { nav.go(.media) }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .buttonStyle(.plain)
                }
            } else {
                HVWidgetTop(symbol: HV.symbol(for: zone), color: HV.media, name: room, state: "Off", more: { nav.sheet = .media(zone.id) })
                Spacer(minLength: 0)
                HVWideButton(title: "Turn on", symbol: "power", tint: HV.media, primary: true) {
                    store.perform(.mediaPower(zoneId: zone.id, on: true))
                }
            }
        }
        .hvWidget()
    }
}

@MainActor
struct HVNowPlayingWidget: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        let on = home.media.filter(\.isOn)
        if let first = on.first {
            HVZoneWidget(zone: first, others: Array(on.dropFirst()))
        } else if !home.media.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                HVWidgetTop(symbol: "music.note", color: HV.media, name: "Media", state: "Nothing playing")
                Spacer(minLength: 0)
                HStack(spacing: 8) {
                    ForEach(home.media.prefix(2)) { zone in
                        HVWideButton(title: home.room(zone.roomId)?.name ?? zone.name, symbol: "power") {
                            store.perform(.mediaPower(zoneId: zone.id, on: true))
                        }
                    }
                }
            }
            .hvWidget()
        }
    }
}

struct HVArtwork: View {
    let source: String
    let symbol: String

    var body: some View {
        let s = source.lowercased()
        let colors: [Color] = s.contains("spotify") ? [.green, .teal]
            : s.contains("apple") ? [Color(white: 0.25), Color(white: 0.55)]
            : s.contains("cable") || s.contains("sat") ? [.blue, .indigo]
            : s.contains("radio") ? [.orange, .pink]
            : [.indigo, .pink]
        Image(systemName: symbol)
            .font(.system(size: 26, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 66, height: 66)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)))
            .shadow(color: .black.opacity(0.2), radius: 10, y: 6)
            .accessibilityHidden(true)
    }
}

struct HVEqualizer: View {
    @State private var up = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(0..<3) { i in
                Capsule().fill(HV.media).frame(width: 3, height: CGFloat(up ? [12, 6, 10][i] : [4, 12, 5][i]))
            }
        }
        .frame(height: 12, alignment: .bottom)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 0.45).repeatForever(autoreverses: true)) { up = true }
        }
        .accessibilityHidden(true)
    }
}

/// Thin volume bar that thickens while you drag it, like Music.
@MainActor
struct HVVolumeBar: View {
    let zone: MediaZone
    @Environment(HomeStore.self) private var store
    @State private var dragValue: Double?
    @State private var lastSent = Date.distantPast

    var body: some View {
        let shown = dragValue ?? zone.volume
        HStack(spacing: 10) {
            Image(systemName: "speaker.fill").font(.caption).foregroundStyle(.secondary)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.primary.opacity(0.12))
                    Capsule().fill(Color.primary).frame(width: max(0, geo.size.width * shown))
                }
                .frame(height: dragValue == nil ? 8 : 14)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            let level = (value.location.x / max(1, geo.size.width)).clamped01
                            dragValue = level
                            // Send while dragging, but not faster than the processor likes.
                            if Date().timeIntervalSince(lastSent) > 0.22 {
                                lastSent = Date()
                                store.perform(.mediaVolume(zoneId: zone.id, level: level))
                            }
                        }
                        .onEnded { _ in
                            if let level = dragValue { store.perform(.mediaVolume(zoneId: zone.id, level: level)) }
                            dragValue = nil
                        }
                )
            }
            .frame(height: 30)
            Image(systemName: "speaker.wave.3.fill").font(.caption).foregroundStyle(.secondary)
        }
        .animation(.easeOut(duration: 0.15), value: dragValue == nil)
        .accessibilityElement()
        .accessibilityLabel("\(zone.name) volume")
        .accessibilityValue(zone.volume.percentText)
        .accessibilityAdjustableAction { direction in
            let step = direction == .increment ? 0.05 : direction == .decrement ? -0.05 : 0
            store.perform(.mediaVolume(zoneId: zone.id, level: (zone.volume + step).clamped01))
        }
    }
}

struct HVMovingBar: View {
    let tint: Color
    @State private var sweep = false

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Capsule().fill(Color.primary.opacity(0.08))
                LinearGradient(colors: [.clear, tint.opacity(0.35), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: sweep ? geo.size.width * 0.7 : -geo.size.width * 0.7)
                Text("Moving…").font(.body.weight(.semibold)).foregroundStyle(.secondary)
            }
            .clipShape(Capsule())
        }
        .frame(height: 58)
        .onAppear { withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) { sweep = true } }
    }
}

// MARK: - Cameras

@MainActor
struct HVCameraTile: View {
    let camera: CameraConfig
    @Environment(HVNav.self) private var nav

    var body: some View {
        Button { nav.sheet = .camera(camera.id) } label: {
            CameraSnapshotView(camera: camera)
                .aspectRatio(16 / 9, contentMode: .fit)
                .overlay(alignment: .bottomLeading) {
                    HStack(spacing: 7) {
                        Circle().fill(.red).frame(width: 7, height: 7)
                        Text(camera.name).font(.footnote.weight(.semibold))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.black.opacity(0.35), in: Capsule())
                    .padding(12)
                }
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .shadow(color: .black.opacity(0.15), radius: 14, y: 8)
        }
        .buttonStyle(HVPress())
        .accessibilityLabel("\(camera.name) camera")
    }
}
