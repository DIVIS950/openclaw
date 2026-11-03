import SwiftUI
import UIKit

/// Small actions shared by tiles, widgets and sheets, with the notice that confirms them.
@MainActor
enum HVAct {
    static func gate(_ store: HomeStore, _ nav: HVNav, _ gate: Gate, _ action: GateAction) {
        let opens = action == .open || (action == .trigger && gate.state != .open)
        store.perform(.gate(id: gate.id, action: action))
        if action == .stop {
            nav.notify(L("{name} stopped", ["name": gate.name]), symbol: "stop.fill", color: .blue)
        } else {
            nav.notify(opens ? L("Opening {name}", ["name": gate.name]) : L("Closing {name}", ["name": gate.name]), symbol: "door.garage.open", color: .blue)
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
            nav.notify(L("{name} locked", ["name": lock.name]), symbol: "lock.fill")
        } else {
            nav.sheet = .lock(lock.id)
        }
    }

    static func scene(_ store: HomeStore, _ nav: HVNav, _ scene: HomeScene) {
        store.perform(.recallScene(id: scene.id))
        nav.notify(L("{name} is on", ["name": scene.name]), symbol: Theme.sceneSymbol(scene), color: .orange)
    }

    /// The same source (by name) and volume in every other music room.
    static func playEverywhere(_ store: HomeStore, _ nav: HVNav, _ lead: MediaZone) {
        guard let source = lead.currentSource else { return }
        for zone in store.home.media where zone.id != lead.id {
            if let same = zone.sources.first(where: { $0.name == source.name }) {
                store.perform(.mediaSource(zoneId: zone.id, sourceId: same.id))
            }
            if zone.hasVolume && lead.hasVolume {
                store.perform(.mediaVolume(zoneId: zone.id, level: lead.volume))
            }
        }
        nav.notify(L("{name} in every room", ["name": source.name]), symbol: "hifispeaker.2.fill", color: HV.media)
    }

    static func allMediaOff(_ store: HomeStore, _ nav: HVNav) {
        for zone in store.home.media where zone.isOn {
            store.perform(.mediaPower(zoneId: zone.id, on: false))
        }
        nav.notify(L("All music and TV off"), symbol: "power", color: HV.media)
    }
}

extension HomeSnapshot {
    /// Media rooms are usually named after their room; on a tile call them TV or Speakers instead.
    func tileName(_ zone: MediaZone) -> String {
        if zone.isTV { return L("TV") }
        guard room(zone.roomId)?.name == zone.name else { return zone.name }
        let names = zone.sources.map(\.name).joined(separator: " ").lowercased()
        return ["tv", "cable", "apple", "satelit"].contains { names.contains($0) } ? L("TV") : L("Speakers")
    }
}

enum HVText {
    static func light(_ light: Light) -> String {
        if !light.isOnline { return L("No response") }
        if !light.isOn { return L("Off") }
        return light.isDimmable ? light.level.percentText : L("On")
    }

    static func shade(_ position: Double) -> String {
        if position >= 0.98 { return L("Open") }
        if position <= 0.02 { return L("Closed") }
        return L("{level} open", ["level": position.percentText])
    }

    static func lock(_ lock: DoorLock) -> String {
        switch lock.isLocked {
        case .some(true): L("Locked")
        case .some(false): L("Unlocked")
        case .none: L("Unknown")
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
    /// Lights: the icon glows as bright as the light is set (and gently breathes).
    var glow: Double?
    /// Changes each time the device was just changed from this iPad: the icon bounces and a ring bursts.
    var pulse = 0
    let toggleLabel: String
    let onToggle: () -> Void
    let onOpen: () -> Void
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onToggle) {
                Image(systemName: symbol)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(isOn ? Color.white : Color.secondary)
                    .symbolEffect(.bounce, value: reduceMotion ? 0 : pulse)
                    .frame(width: 46, height: 46)
                    .background { iconCircle }
                    .overlay { HVRingBurst(trigger: pulse, color: color) }
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
            .accessibilityHint(L("Shows more controls"))
        }
        .padding(12)
        .frame(minHeight: 76)
        .background { background }
        .environment(\.colorScheme, isOn ? .light : scheme)
        .opacity(offline ? 0.55 : 1)
        .animation(.easeOut(duration: 0.25), value: isOn)
    }

    /// The colored circle behind the icon. Lights glow by level; the rest keep a plain shadow.
    @ViewBuilder
    private var iconCircle: some View {
        let circle = Circle().fill(isOn ? color : Color.primary.opacity(0.08))
        if let glow {
            circle.modifier(HVLampGlow(color: color, level: isOn ? max(glow, 0.05) : 0))
        } else {
            circle.shadow(color: isOn ? color.opacity(0.45) : .clear, radius: 8, y: 4)
        }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var runs = 0
    /// Where the icon is on screen, for the color ripple. A plain object, so updating it while
    /// the page scrolls doesn't redraw the tile.
    @State private var spot = HVSpot()

    var body: some View {
        Button {
            runs += 1
            if !reduceMotion, let center = spot.center { nav.showRipple(at: center, color: color) }
            HVAct.scene(store, nav, scene)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: Theme.sceneSymbol(scene))
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(Circle().fill(color))
                    .symbolEffect(.bounce, value: reduceMotion ? 0 : store.pulse("scene:\(scene.id)"))
                    .overlay { HVRingBurst(trigger: store.pulse("scene:\(scene.id)"), color: color) }
                    .background {
                        GeometryReader { geo in
                            let frame = geo.frame(in: .global)
                            Color.clear.preference(key: HVCenterKey.self, value: CGPoint(x: frame.midX, y: frame.midY))
                        }
                    }
                    .onPreferenceChange(HVCenterKey.self) { center in spot.center = center }
                VStack(alignment: .leading, spacing: 1) {
                    Text(scene.name).font(.subheadline.weight(.semibold)).lineLimit(1)
                    Text(scene.isActive ? L("Active") : L("Scene")).font(.footnote.weight(.medium)).foregroundStyle(.secondary)
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
        .accessibilityLabel(scene.isActive ? L("{name} scene, active", ["name": scene.name]) : L("{name} scene", ["name": scene.name]))
    }
}

/// The thermostats, lights, shades, media rooms, locks and switches given, as tiles.
@MainActor
struct HVAccessoryGrid: View {
    var climate: [Climate] = []
    var lights: [Light] = []
    var shades: [Shade] = []
    var media: [MediaZone] = []
    var locks: [DoorLock] = []
    var switches: [HomeSwitch] = []
    var showRoom = false
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        let roomName = { (id: String?) in showRoom ? home.room(id)?.name : nil }
        LazyVGrid(columns: HV.tileColumns, spacing: 12) {
            ForEach(climate) { HVClimateTile(climate: $0, showRoom: showRoom) }
            ForEach(lights) { HVLightTile(light: $0, room: roomName($0.roomId)) }
            ForEach(shades) { HVShadeTile(shade: $0, room: roomName($0.roomId)) }
            ForEach(media) { HVMediaTile(zone: $0, room: roomName($0.roomId)) }
            ForEach(locks) { HVLockTile(lock: $0, room: roomName($0.roomId)) }
            ForEach(switches) { HVSwitchTile(item: $0, room: roomName($0.roomId)) }
        }
    }
}

@MainActor
struct HVLightTile: View {
    let light: Light
    var room: String?
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let toggleLabel = light.isOn ? L("{name}: turn off", ["name": light.name]) : L("{name}: turn on", ["name": light.name])
        HVTile(symbol: light.isOn ? "lightbulb.fill" : "lightbulb", name: light.name, state: HVText.light(light),
               color: HV.light, isOn: light.isOn, room: room, offline: !light.isOnline,
               level: light.isDimmable ? light.level : nil, glow: light.level, pulse: store.pulse("light:\(light.id)"),
               toggleLabel: toggleLabel,
               onToggle: { store.toggle(light: light.id) }, onOpen: { nav.sheet = .light(light.id) })
    }
}

@MainActor
struct HVShadeTile: View {
    let shade: Shade
    var room: String?
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let open = shade.position > 0.02
        let toggleLabel = open ? L("{name}: close", ["name": shade.name]) : L("{name}: open", ["name": shade.name])
        HVTile(symbol: open ? "blinds.horizontal.open" : "blinds.horizontal.closed", name: shade.name, state: HVText.shade(shade.position),
               color: HV.shade, isOn: open, room: room, offline: !shade.isOnline, pulse: store.pulse("shade:\(shade.id)"),
               toggleLabel: toggleLabel,
               onToggle: { store.perform(.setShade(id: shade.id, position: open ? 0 : 1)) }, onOpen: { nav.sheet = .shade(shade.id) })
    }
}

@MainActor
struct HVMediaTile: View {
    let zone: MediaZone
    var room: String?
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let source = zone.canRemote ? HVText.tvState(zone) : (zone.currentSource?.name ?? L("On"))
        let volume = zone.isMuted ? L("Muted") : zone.volume.percentText
        let state = zone.isOn ? (zone.hasVolume ? "\(source) · \(volume)" : source) : L("Off")
        let toggleLabel = zone.isOn ? L("{name}: turn off", ["name": zone.name]) : L("{name}: turn on", ["name": zone.name])
        HVTile(symbol: HV.symbol(for: zone), name: store.home.tileName(zone), state: state, color: HV.media, isOn: zone.isOn,
               room: room, pulse: store.pulse("media:\(zone.id)"),
               toggleLabel: toggleLabel,
               onToggle: { store.perform(.mediaPower(zoneId: zone.id, on: !zone.isOn)) }, onOpen: { nav.sheet = .media(zone.id) })
    }
}

@MainActor
struct HVLockTile: View {
    let lock: DoorLock
    var room: String?
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let unlocked = lock.isLocked == false
        let toggleLabel = unlocked ? L("Lock {name}", ["name": lock.name]) : L("Unlock {name}", ["name": lock.name])
        HVTile(symbol: unlocked ? "lock.open.fill" : "lock.fill", name: lock.name, state: HVText.lock(lock),
               color: unlocked ? .orange : .green, isOn: lock.isLocked != nil, room: room, warn: unlocked,
               pulse: store.pulse("lock:\(lock.id)"), toggleLabel: toggleLabel,
               onToggle: { HVAct.lockTapped(store, nav, lock) }, onOpen: { nav.sheet = .lock(lock.id) })
    }
}

/// Where a view's center is on screen.
private struct HVCenterKey: PreferenceKey {
    static let defaultValue: CGPoint? = nil
    static func reduce(value: inout CGPoint?, nextValue: () -> CGPoint?) {
        value = nextValue() ?? value
    }
}

/// Holds a point without SwiftUI watching it.
final class HVSpot {
    var center: CGPoint?
}

extension HV {
    static let tileColumns = [GridItem(.adaptive(minimum: 184), spacing: 12)]
    static let widgetColumns = [GridItem(.adaptive(minimum: 258), spacing: 14, alignment: .top)]

    /// A scene keeps the same color wherever it appears (Home, Favorites).
    static func sceneColor(_ scene: HomeScene, in home: HomeSnapshot) -> Color {
        let index = home.scenes.firstIndex { $0.id == scene.id } ?? 0
        return sceneColors[index % sceneColors.count]
    }
}

@MainActor
struct HVSection<Content: View>: View {
    let title: String
    var open: (() -> Void)?
    /// Small green capsule beside the title, e.g. "Vacation mode on".
    var badge: String? = nil
    /// A text button at the right end of the title row, e.g. "Edit".
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                if let open {
                    Button(action: open) {
                        HStack(spacing: 3) {
                            Text(title)
                            Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                    .font(.title3.weight(.bold))
                    .accessibilityHint(L("Opens {name}", ["name": title]))
                } else {
                    Text(title).font(.title3.weight(.bold)).accessibilityAddTraits(.isHeader)
                }
                if let badge {
                    Text(badge)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.green)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color.green.opacity(0.18)))
                }
                Spacer(minLength: 0)
                if let actionTitle, let action {
                    Button(actionTitle, action: action)
                        .font(.body.weight(.semibold))
                        .buttonStyle(.plain)
                        .foregroundStyle(.blue)
                }
            }
            content
        }
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
            if let more { HVMoreButton(label: L("{name} controls", ["name": name]), action: more) }
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

extension View {
    /// The frosted card every Home widget sits on. It leans a little toward the finger.
    func hvWidget() -> some View {
        padding(18)
            .frame(maxWidth: .infinity, minHeight: 184, alignment: .topLeading)
            .hvGlass(HV.widgetRadius)
            .hvTilt(3)
    }
}

@MainActor
struct HVGateWidget: View {
    let gate: Gate
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HVWidgetTop(symbol: gate.state == .open ? "door.garage.open" : "door.garage.closed", color: HV.gate, name: gate.name,
                        state: gate.state.label, more: { nav.sheet = .gate(gate.id) })
            HVGateArt(state: gate.state, color: HV.gate)
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
                    HVWideButton(title: L("Stop"), symbol: "stop.fill") { HVAct.gate(store, nav, gate, .stop) }
                }
            }
        case .open:
            HVWideButton(title: L("Close {name}", ["name": gate.name]), symbol: "arrow.right.and.line.vertical.and.arrow.left", tint: HV.gate, primary: true) {
                HVAct.gate(store, nav, gate, gate.hasSeparateOpenClose ? .close : .trigger)
            }
        case .closed, .unknown:
            // Opening is a deliberate slide all the way across, so a stray tap never opens the gate.
            HVSlideToOpen(tint: HV.gate, label: L("slide to open"), accessibilityName: L("Open {name}", ["name": gate.name])) {
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
                        color: HV.alarmColor(panel.mode), name: panel.name, state: panel.mode.label, stateColor: panel.mode == .alarm ? .red : nil)
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                if panel.canArmAway { segment(L("Away"), "figure.walk.departure", .armedAway) }
                if panel.canArmHome { segment(L("At home"), "house.fill", .armedHome) }
                segment(L("Off"), "shield", .disarmed)
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
        .accessibilityLabel(mode == .disarmed ? L("Disarm") : mode == .armedAway ? L("Arm away") : L("Arm home"))
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
        let source = zone.currentSource?.name ?? L("On")
        let track = zone.nowPlaying
        // Song first when the system sends it, then artist, source and room.
        let parts: [String?] = [track?.artist, track == nil ? nil : source, room]
        let detail = parts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        VStack(alignment: .leading, spacing: 14) {
            if zone.isOn {
                HStack(spacing: 14) {
                    HVArtwork(source: source, symbol: HV.symbol(for: zone), title: track?.title)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(track?.title ?? source).font(.title3.weight(.bold)).lineLimit(2)
                        HStack(spacing: 6) {
                            Text(detail).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary).lineLimit(2)
                            if zone.isMuted {
                                Text("· \(L("Muted"))").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                            } else if zone.isPlaying {
                                HVEqualizer()
                            } else {
                                Text("· \(L("Paused"))").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    HVMoreButton(label: L("{name} controls", ["name": zone.name])) { nav.sheet = .media(zone.id) }
                }
                Spacer(minLength: 0)
                if zone.canTransport { HVTransport(zone: zone) }
                if zone.hasVolume { HVVolumeBar(zone: zone) }
                if !others.isEmpty {
                    Button(L("Also playing in {rooms}", ["rooms": others.map { home.room($0.roomId)?.name ?? $0.name }.joined(separator: ", ")])) { nav.go(.media) }
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .buttonStyle(.plain)
                }
            } else {
                HVWidgetTop(symbol: HV.symbol(for: zone), color: HV.media, name: room, state: L("Off"), more: { nav.sheet = .media(zone.id) })
                Spacer(minLength: 0)
                HVWideButton(title: L("Turn on"), symbol: "power", tint: HV.media, primary: true) {
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
                HVWidgetTop(symbol: "music.note", color: HV.media, name: L("Media"), state: L("Nothing playing"))
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
    /// The song name: music gets colors made from it, so each song looks a little different.
    var title: String?
    var size: CGFloat = 66

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.4, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(RoundedRectangle(cornerRadius: size * 0.24, style: .continuous).fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)))
            .shadow(color: .black.opacity(0.2), radius: 10, y: 6)
            .accessibilityHidden(true)
    }

    private var colors: [Color] {
        let s = source.lowercased()
        if s.contains("spotify") { return [.green, .teal] }
        if s.contains("apple") { return [Color(white: 0.25), Color(white: 0.55)] }
        if s.contains("cable") || s.contains("sat") { return [.blue, .indigo] }
        if let title, !title.isEmpty, symbol != "tv" {
            let hue = title.utf16.reduce(7) { ($0 * 31 + Int($1)) % 360 }
            return [HV.hsl(Double(hue), 0.8, 0.62), HV.hsl(Double(hue + 70), 0.85, 0.5)]
        }
        if s.contains("radio") { return [.orange, .pink] }
        return [.indigo, .pink]
    }
}

/// Previous, play or pause, next.
@MainActor
struct HVTransport: View {
    let zone: MediaZone
    var big = false
    @Environment(HomeStore.self) private var store

    var body: some View {
        HStack(spacing: big ? 26 : 18) {
            button(.previous, "backward.fill", L("Previous"), main: false)
            if zone.isPlaying {
                button(.pause, "pause.fill", L("Pause"), main: true)
            } else {
                button(.play, "play.fill", L("Play"), main: true)
            }
            button(.next, "forward.fill", L("Next"), main: false)
        }
        .frame(maxWidth: .infinity)
    }

    private func button(_ action: MediaTransportAction, _ symbol: String, _ label: String, main: Bool) -> some View {
        let side: CGFloat = main ? (big ? 64 : 52) : (big ? 52 : 44)
        return Button {
            store.perform(.mediaTransport(zoneId: zone.id, action: action))
        } label: {
            Image(systemName: symbol)
                .font(.system(size: main ? (big ? 26 : 22) : 20, weight: .semibold))
                .foregroundStyle(main ? Color(uiColor: .systemBackground) : Color.primary)
                .frame(width: side, height: side)
                .background(Circle().fill(main ? Color.primary : Color.clear))
                .contentShape(Circle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(label)
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
                    DragGesture(minimumDistance: 4)
                        .onChanged { value in
                            // Leave mostly-vertical swipes alone so the page can still scroll.
                            if dragValue == nil && abs(value.translation.height) > abs(value.translation.width) { return }
                            let level = Double(value.location.x / max(1, geo.size.width)).clamped01
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
                .onTapGesture { location in
                    store.perform(.mediaVolume(zoneId: zone.id, level: Double(location.x / max(1, geo.size.width)).clamped01))
                }
            }
            .frame(height: 30)
            Image(systemName: "speaker.wave.3.fill").font(.caption).foregroundStyle(.secondary)
        }
        .animation(.easeOut(duration: 0.15), value: dragValue == nil)
        .accessibilityElement()
        .accessibilityLabel(L("{name} volume", ["name": zone.name]))
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
                Text(L("Moving…")).font(.body.weight(.semibold)).foregroundStyle(.secondary)
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
        .accessibilityLabel(L("{name} camera", ["name": camera.name]))
    }
}
