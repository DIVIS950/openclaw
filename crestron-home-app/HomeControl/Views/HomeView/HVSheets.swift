import SwiftUI
import UIKit

/// The card that opens over the page: big controls for one accessory, the keypad, a camera.
@MainActor
struct HVSheetContent: View {
    let sheet: HVNav.Sheet
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        Group {
            switch sheet {
            case let .light(id):
                if let light = home.lights.first(where: { $0.id == id }) { HVLightSheet(light: light) } else { gone }
            case let .shade(id):
                if let shade = home.shades.first(where: { $0.id == id }) { HVShadeSheet(shade: shade) } else { gone }
            case let .media(id):
                if let zone = home.media.first(where: { $0.id == id }) { HVMediaSheet(zone: zone) } else { gone }
            case let .lock(id):
                if let lock = home.locks.first(where: { $0.id == id }) { HVLockSheet(lock: lock) } else { gone }
            case let .gate(id):
                if let gate = home.gates.first(where: { $0.id == id }) { HVGateSheet(gate: gate) } else { gone }
            case let .camera(id):
                if let camera = settings.cameras.first(where: { $0.id == id }) { HVCameraSheet(camera: camera) } else { gone }
            case let .keypad(panelId, mode):
                HVKeypadSheet(panelId: panelId, mode: mode)
            case let .confirmGate(id, action):
                if let gate = home.gates.first(where: { $0.id == id }) { HVConfirmGateSheet(gate: gate, action: action) } else { gone }
            case .settings:
                NavigationStack {
                    SettingsView(isSheet: true, homeView: true,
                                 openEditHome: { nav.sheet = .editHome }, openFavorites: { nav.sheet = .favorites })
                }
            case .editHome:
                HVEditHomeSheet()
            case .favorites:
                HVFavoritesSheet()
            case let .schedule(draft):
                HVScheduleSheet(schedule: draft, isNew: !automations.schedules.contains { $0.id == draft.id })
            }
        }
    }

    private var gone: some View {
        ContentUnavailableView("Not available", systemImage: "questionmark.circle", description: Text("This device isn't in the system anymore."))
            .padding(40)
    }
}

/// Icon, name and room at the top of a card, with a close button. With `favorite`
/// ("light:l1"), a star adds it to or removes it from Favorites.
@MainActor
struct HVSheetHeader: View {
    let symbol: String
    let color: Color
    let title: String
    var subtitle: String?
    var favorite: String? = nil
    @Environment(HVNav.self) private var nav
    @Environment(HomeLayout.self) private var layout

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(color))
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.title3.weight(.bold)).lineLimit(1)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if let favorite {
                let on = layout.isFavorite(favorite)
                Button {
                    let added = layout.toggleFavorite(favorite)
                    nav.notify(added ? "Added to Favorites" : "Removed from Favorites", symbol: "star.fill", color: HV.light)
                } label: {
                    Image(systemName: on ? "star.fill" : "star")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(on ? HV.light : Color.secondary)
                        .frame(width: 34, height: 34)
                        .background(Circle().fill(on ? HV.light.opacity(0.18) : Color.primary.opacity(0.1)))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel(on ? "Remove from Favorites" : "Add to Favorites")
            }
            Button { nav.sheet = nil } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .background(Circle().fill(Color.primary.opacity(0.1)))
            }
            .buttonStyle(HVPress())
            .accessibilityLabel("Close")
        }
    }
}

extension View {
    /// Padding and minimum width for the cards that open over the page.
    func hvCard() -> some View {
        padding(.horizontal, 24)
            .padding(.top, 22)
            .padding(.bottom, 28)
            .frame(minWidth: 420)
    }
}

struct HVPill: View {
    let title: String
    var symbol: String?
    var selected = false
    var small = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let symbol { Image(systemName: symbol) }
                Text(title)
            }
            .font(small ? Font.footnote.weight(.semibold) : Font.subheadline.weight(.semibold))
            .padding(.horizontal, small ? 13 : 16)
            .padding(.vertical, small ? 8 : 10)
            .foregroundStyle(selected ? Color(uiColor: .systemBackground) : Color.primary)
            .background(Capsule().fill(selected ? Color.primary : Color.primary.opacity(0.1)))
        }
        .buttonStyle(HVPress())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

@MainActor
private struct HVBigValue: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 46, weight: .bold))
            .monospacedDigit()
            .contentTransition(.numericText())
            .animation(.snappy, value: text)
    }
}

@MainActor
struct HVLightSheet: View {
    let light: Light
    @Environment(HomeStore.self) private var store

    var body: some View {
        VStack(spacing: 22) {
            HVSheetHeader(symbol: "lightbulb.fill", color: HV.light, title: light.name, subtitle: store.home.room(light.roomId)?.name,
                          favorite: FavoriteKind.light.key(light.id))
            HVBigValue(text: HVText.light(light))
            if light.isDimmable {
                HVBigSlider(value: light.level, style: .light, symbol: light.isOn ? "lightbulb.fill" : "lightbulb", label: "\(light.name) brightness") { level in
                    store.perform(.setLight(id: light.id, level: level))
                }
                HStack(spacing: 8) {
                    ForEach([0, 0.25, 0.5, 0.75, 1.0], id: \.self) { level in
                        HVPill(title: level == 0 ? "Off" : level.percentText, selected: abs(light.level - level) < 0.02) {
                            store.perform(.setLight(id: light.id, level: level))
                        }
                    }
                }
            } else {
                Button { store.toggle(light: light.id) } label: {
                    HVBigSlider(value: light.isOn ? 1 : 0, style: .light, symbol: "lightbulb.fill", label: light.name) { _ in }
                        .allowsHitTesting(false)
                }
                .buttonStyle(HVPress())
                .accessibilityLabel("\(light.name): turn \(light.isOn ? "off" : "on")")
                Text("Tap to turn \(light.isOn ? "off" : "on").").font(.subheadline).foregroundStyle(.secondary)
            }
            if light.isOn {
                HVTimerPills(verb: "Turn off", label: "\(light.name) off", command: .light(id: light.id, level: 0))
            }
        }
        .hvCard()
    }
}

@MainActor
struct HVShadeSheet: View {
    let shade: Shade
    @Environment(HomeStore.self) private var store

    var body: some View {
        VStack(spacing: 22) {
            HVSheetHeader(symbol: "blinds.horizontal.closed", color: HV.shade, title: shade.name, subtitle: store.home.room(shade.roomId)?.name,
                          favorite: FavoriteKind.shade.key(shade.id))
            HVBigValue(text: HVText.shade(shade.position))
            if shade.supportsPosition {
                HVBigSlider(value: shade.position, style: .shade, symbol: "blinds.horizontal.closed", label: "\(shade.name) position") { position in
                    store.perform(.setShade(id: shade.id, position: position))
                }
            }
            HStack(spacing: 8) {
                HVPill(title: "Open", symbol: "arrow.up") { store.perform(.setShade(id: shade.id, position: 1)) }
                if shade.supportsStop {
                    HVPill(title: "Stop", symbol: "stop.fill") { store.perform(.stopShade(id: shade.id)) }
                }
                HVPill(title: "Close", symbol: "arrow.down") { store.perform(.setShade(id: shade.id, position: 0)) }
            }
            if shade.position > 0.02 {
                HVTimerPills(verb: "Close", label: "\(shade.name) closed", command: .shade(id: shade.id, position: 0))
            }
        }
        .hvCard()
    }
}

@MainActor
struct HVMediaSheet: View {
    let zone: MediaZone
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let source = zone.currentSource?.name ?? ""
        let state = zone.isPlaying ? "Playing" : "Paused"
        VStack(alignment: .leading, spacing: 20) {
            HVSheetHeader(symbol: HV.symbol(for: zone), color: HV.media, title: zone.name,
                          subtitle: zone.isOn ? "\(state) · \(source)" : "Off", favorite: FavoriteKind.media.key(zone.id))
            HStack(alignment: .top, spacing: 26) {
                if zone.hasVolume {
                    VStack(spacing: 14) {
                        HVBigValue(text: zone.isMuted ? "Muted" : zone.volume.percentText)
                        HVBigSlider(value: zone.volume, style: .volume, symbol: zone.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                                    label: "\(zone.name) volume") { level in
                            store.perform(.mediaVolume(zoneId: zone.id, level: level))
                        }
                        HVPill(title: zone.isMuted ? "Unmute" : "Mute", symbol: zone.isMuted ? "speaker.wave.2.fill" : "speaker.slash.fill", selected: zone.isMuted) {
                            store.perform(.mediaMute(zoneId: zone.id, muted: !zone.isMuted))
                        }
                    }
                }
                VStack(alignment: .leading, spacing: 18) {
                    if zone.isOn {
                        nowPlaying(source: source, state: state)
                        if zone.currentSourceId != nil && store.home.media.count > 1 {
                            HVPill(title: "Play this in every room", symbol: "hifispeaker.2.fill") {
                                HVAct.playEverywhere(store, nav, zone)
                            }
                        }
                    }
                    Toggle(isOn: Binding(get: { zone.isOn }, set: { store.perform(.mediaPower(zoneId: zone.id, on: $0)) })) {
                        Label("Power", systemImage: "power").font(.body.weight(.semibold))
                    }
                    .tint(.green)
                    .padding(14)
                    .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.07)))
                    if !zone.sources.isEmpty {
                        Text("SOURCE").font(.footnote.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary).padding(.horizontal, 14)
                        VStack(spacing: 0) {
                            ForEach(zone.sources) { source in
                                let current = zone.isOn && zone.currentSourceId == source.id
                                Button { store.perform(.mediaSource(zoneId: zone.id, sourceId: source.id)) } label: {
                                    HStack {
                                        Text(source.name).font(.body)
                                        Spacer()
                                        if current { Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(.blue) }
                                    }
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 50)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(current ? .isSelected : [])
                                if source.id != zone.sources.last?.id { Divider().padding(.leading, 14) }
                            }
                        }
                        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.07)))
                    }
                    if zone.isOn {
                        HVTimerPills(verb: "Sleep timer: off", label: "\(zone.name) off", command: .mediaPower(id: zone.id, on: false))
                    }
                }
                .frame(minWidth: 260)
            }
        }
        .hvCard()
    }

    /// Artwork, song and artist, and the play buttons.
    private func nowPlaying(source: String, state: String) -> some View {
        let track = zone.nowPlaying
        let artist = [track?.artist ?? "", track?.album ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
        return VStack(spacing: 12) {
            HVArtwork(source: source, symbol: HV.symbol(for: zone), title: track?.title, size: 132)
            VStack(spacing: 2) {
                Text(track?.title ?? (source.isEmpty ? "On" : source)).font(.title3.weight(.bold)).multilineTextAlignment(.center)
                Text(artist.isEmpty ? state : artist).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            }
            if zone.canTransport { HVTransport(zone: zone, big: true) }
        }
        .frame(maxWidth: .infinity)
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Color.primary.opacity(0.07)))
    }
}

/// "Turn off in 15 min / 30 min / 1 h / 2 h": a timer that runs on this iPad.
@MainActor
struct HVTimerPills: View {
    let verb: String
    let label: String
    let command: TimerCommand
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(spacing: 8) {
            Label("\(verb) in", systemImage: "timer")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                ForEach([15, 30, 60, 120], id: \.self) { minutes in
                    let text = minutes >= 60 ? "\(minutes / 60) h" : "\(minutes) min"
                    HVPill(title: text, small: true) {
                        automations.addTimer(minutes: minutes, label: label, command: command)
                        nav.notify("\(label) in \(text)", symbol: "timer", color: .orange)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

@MainActor
struct HVLockSheet: View {
    let lock: DoorLock
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let unlocked = lock.isLocked == false
        VStack(spacing: 22) {
            HVSheetHeader(symbol: unlocked ? "lock.open.fill" : "lock.fill", color: unlocked ? .orange : .green,
                          title: lock.name, subtitle: store.home.room(lock.roomId)?.name, favorite: FavoriteKind.lock.key(lock.id))
            HVBigValue(text: HVText.lock(lock))
            if unlocked {
                Button { HVAct.lockTapped(store, nav, lock) } label: {
                    Image(systemName: "lock.open.fill")
                        .font(.system(size: 44, weight: .medium))
                        .foregroundStyle(.orange)
                        .frame(width: 140, height: 140)
                        .background(Circle().fill(Color.orange.opacity(0.16)))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel("Lock \(lock.name)")
                Text("Tap to lock.").font(.subheadline).foregroundStyle(.secondary)
            } else {
                HVHoldButton(symbol: "lock.fill", tint: .green, label: "Unlock \(lock.name)") {
                    store.perform(.setLock(id: lock.id, locked: false))
                    nav.notify("\(lock.name) unlocked", symbol: "lock.open.fill", color: .orange)
                    nav.sheet = nil
                }
                Text("Press and hold for a second to unlock.").font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .hvCard()
    }
}

@MainActor
struct HVGateSheet: View {
    let gate: Gate
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(spacing: 22) {
            HVSheetHeader(symbol: "door.garage.closed", color: HV.gate, title: gate.name, subtitle: "Gate")
            HVBigValue(text: gate.state.title)
            HVGateControls(gate: gate).frame(maxWidth: 380)
            if gate.state != .moving {
                HStack(spacing: 8) {
                    if gate.hasSeparateOpenClose && gate.state != .closed {
                        HVPill(title: "Close", symbol: "arrow.right.and.line.vertical.and.arrow.left") { HVAct.gate(store, nav, gate, .close) }
                    }
                    if gate.canStop {
                        HVPill(title: "Stop", symbol: "stop.fill") { HVAct.gate(store, nav, gate, .stop) }
                    }
                }
            }
        }
        .hvCard()
    }
}

@MainActor
struct HVConfirmGateSheet: View {
    let gate: Gate
    let action: GateAction
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(spacing: 22) {
            HVSheetHeader(symbol: "door.garage.open", color: HV.gate, title: "Open \(gate.name)?")
            Text("Make sure the way is clear.").font(.body).foregroundStyle(.secondary)
            HStack(spacing: 10) {
                HVWideButton(title: "Cancel", symbol: "xmark") { nav.sheet = nil }
                HVWideButton(title: "Open", symbol: "door.garage.open", tint: HV.gate, primary: true) {
                    nav.sheet = nil
                    HVAct.gate(store, nav, gate, action)
                }
            }
        }
        .hvCard()
    }
}

@MainActor
struct HVKeypadSheet: View {
    let panelId: String
    let mode: SecurityMode
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let panel = store.home.security.first { $0.id == panelId }
        let verb = mode == .armedAway ? "Arm away" : mode == .armedHome ? "Arm home" : "Disarm"
        VStack(spacing: 20) {
            HVSheetHeader(symbol: "shield.fill", color: .indigo, title: panel?.name ?? "Alarm", subtitle: panel?.mode.title)
            Text("Enter your code to \(verb.lowercased())").font(.body.weight(.medium))
            HVKeypad(actionTitle: verb) { code in
                store.perform(.setSecurity(id: panelId, mode: mode, code: code))
                nav.sheet = nil
                nav.notify(mode == .disarmed ? "Alarm disarmed" : verb == "Arm away" ? "Armed away" : "Armed home", symbol: "checkmark.shield.fill", color: .indigo)
            }
        }
        .hvCard()
    }
}

@MainActor
struct HVCameraSheet: View {
    let camera: CameraConfig

    var body: some View {
        VStack(spacing: 18) {
            HVSheetHeader(symbol: "video.fill", color: HV.camera, title: camera.name, subtitle: "Live")
            CameraSnapshotView(camera: camera, interval: .milliseconds(500))
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .frame(minWidth: 640)
        }
        .hvCard()
    }
}
