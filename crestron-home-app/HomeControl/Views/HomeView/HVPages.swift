import SwiftUI

private struct HVCompactKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True when the window is too narrow for the sidebar (iPad split view, iPhone).
    var hvCompact: Bool {
        get { self[HVCompactKey.self] }
        set { self[HVCompactKey.self] = newValue }
    }
}

/// Date line, big title, and on the right the clock, Ask Home and Settings.
@MainActor
struct HVHeader: View {
    let eyebrow: String
    let title: String
    var subtitle: String?
    var showBack = false
    /// Home shows the weather above the clock and an Edit Home button.
    var isHome = false
    @Environment(HVNav.self) private var nav
    @Environment(WeatherStore.self) private var weather
    @Environment(\.hvCompact) private var compact

    var body: some View {
        HStack(alignment: .bottom, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                if showBack {
                    Button { nav.go(.home) } label: {
                        Label("Home", systemImage: "chevron.left").font(.body.weight(.semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
                }
                Text(eyebrow.uppercased())
                    .font(.footnote.weight(.semibold))
                    .tracking(0.8)
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.system(size: compact ? 30 : 38, weight: .bold))
                    .tracking(-0.8)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle).font(.body).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 12)
            if !compact {
                VStack(alignment: .trailing, spacing: 2) {
                    if isHome, let w = weather.weather {
                        HStack(spacing: 6) {
                            Image(systemName: w.symbol).symbolRenderingMode(.multicolor)
                            Text("\(w.temp)°").font(.body.weight(.semibold))
                            Text("H \(w.high)° · L \(w.low)°").font(.subheadline).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("\(w.text), \(w.temp) degrees, high \(w.high), low \(w.low)")
                    }
                    HVClock(size: 62)
                }
            }
            HStack(spacing: 10) {
                if compact {
                    roundButton("square.grid.2x2", label: "Rooms and controls") { nav.sidebarOpen = true }
                }
                if isHome {
                    roundButton("square.and.pencil", label: "Edit Home") { nav.sheet = .editHome }
                }
                Button { nav.askOpen = true } label: {
                    HVOrb(size: 26).frame(width: 46, height: 46).background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(HVPress())
                .accessibilityLabel("Ask Home")
                roundButton("gearshape.fill", label: "Settings") { nav.sheet = .settings }
            }
        }
    }

    private func roundButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 46, height: 46)
                .background(.ultraThinMaterial, in: Circle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(label)
    }
}

@MainActor
struct HVConnectionNotice: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        if case let .failed(message) = store.connection {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.orange.opacity(0.18)))
        }
    }
}

// MARK: - Home

/// The Home overview page: the parts chosen in Edit Home, in their order. The header,
/// page tabs and the other Home pages are in HVHomePager.
@MainActor
struct HVOverviewBody: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(HomeLayout.self) private var layout
    @Environment(HVNav.self) private var nav

    /// One row of widgets, or one full-width part.
    private enum Block: Identifiable {
        case widgets([HomePart])
        case part(HomePart)

        var id: String {
            switch self {
            case let .widgets(parts): "widgets:\(parts.first?.rawValue ?? "")"
            case let .part(part): part.rawValue
            }
        }
    }

    var body: some View {
        let home = store.home
        let nothing = home.rooms.isEmpty && home.lights.isEmpty && home.scenes.isEmpty
        VStack(alignment: .leading, spacing: 28) {
            ForEach(blocks(home)) { block in
                switch block {
                case let .widgets(parts):
                    LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                        ForEach(parts) { widget($0) }
                    }
                case let .part(part):
                    section(part)
                }
            }
            if nothing && store.connection == .connected {
                ContentUnavailableView("No devices yet", systemImage: "house", description: Text("Open Settings to connect your Crestron system."))
            }
            Button { nav.sheet = .editHome } label: {
                Label("Edit Home", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.primary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .hvGlass(30)
            }
            .buttonStyle(HVPress())
            .frame(maxWidth: .infinity)
        }
    }

    /// The parts this iPad shows, in order, leaving out empty ones. Widgets next to each
    /// other share one adaptive row.
    private func blocks(_ home: HomeSnapshot) -> [Block] {
        var result: [Block] = []
        var row: [HomePart] = []
        for part in layout.parts where shows(part, home) {
            if part.isWidget {
                row.append(part)
            } else {
                if !row.isEmpty { result.append(.widgets(row)) }
                row = []
                result.append(.part(part))
            }
        }
        if !row.isEmpty { result.append(.widgets(row)) }
        return result
    }

    private func shows(_ part: HomePart, _ home: HomeSnapshot) -> Bool {
        switch part {
        case .status:
            return !(home.lights.isEmpty && home.security.isEmpty && home.locks.isEmpty && home.gates.isEmpty
                && home.shades.isEmpty && home.media.isEmpty)
        case .weather, .favorites, .upcoming, .rooms: return true
        case .gate: return !home.gates.isEmpty
        case .alarm: return !home.security.isEmpty
        case .music: return !home.media.isEmpty
        case .scenes: return !home.homeScenes.isEmpty
        case .cameras: return !settings.cameras.isEmpty
        }
    }

    @ViewBuilder
    private func widget(_ part: HomePart) -> some View {
        let home = store.home
        switch part {
        case .weather: HVWeatherWidget()
        case .gate: ForEach(home.gates) { HVGateWidget(gate: $0) }
        case .alarm: if let panel = home.security.first { HVSecurityWidget(panel: panel) }
        case .music: HVNowPlayingWidget()
        default: EmptyView()
        }
    }

    @ViewBuilder
    private func section(_ part: HomePart) -> some View {
        let home = store.home
        switch part {
        case .status:
            HVStatusChips()
        case .favorites:
            HVFavoritesPart()
        case .scenes:
            HVSection(title: "Scenes") {
                LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                    ForEach(home.homeScenes) { scene in
                        HVSceneTile(scene: scene, color: HV.sceneColor(scene, in: home))
                    }
                }
            }
        case .upcoming:
            HVUpcomingPart()
        case .cameras:
            HVSection(title: "Cameras", open: { nav.go(.cameras) }) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                    ForEach(settings.cameras.prefix(2)) { HVCameraTile(camera: $0) }
                }
            }
        case .rooms:
            HVRoomsPart()
        default:
            EmptyView()
        }
    }
}

/// Every room with its accessories, then "Other" for devices without a known room.
@MainActor
private struct HVRoomsPart: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        ForEach(home.rooms) { room in
            let lights = home.lights(in: room.id), shades = home.shades(in: room.id)
            let media = home.media(in: room.id), locks = home.locks(in: room.id)
            if !(lights.isEmpty && shades.isEmpty && media.isEmpty && locks.isEmpty) {
                HVSection(title: room.name, open: { nav.go(.room(room.id)) }) {
                    HVAccessoryGrid(lights: lights, shades: shades, media: media, locks: locks)
                }
            }
        }
        let known = { (id: String?) in home.knownRoomId(id) != nil }
        let otherLights = home.lights.filter { !known($0.roomId) }, otherShades = home.shades.filter { !known($0.roomId) }
        let otherMedia = home.media.filter { !known($0.roomId) }, otherLocks = home.locks.filter { !known($0.roomId) }
        if !(otherLights.isEmpty && otherShades.isEmpty && otherMedia.isEmpty && otherLocks.isEmpty) {
            HVSection(title: "Other") {
                HVAccessoryGrid(lights: otherLights, shades: otherShades, media: otherMedia, locks: otherLocks)
            }
        }
    }
}

// MARK: - Room

@MainActor
struct HVRoomPage: View {
    let roomId: String
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        let room = home.room(roomId) ?? Room(id: roomId, name: "Room")
        let lights = home.lights(in: roomId), shades = home.shades(in: roomId)
        let scenes = home.scenes(in: roomId), media = home.media(in: roomId), locks = home.locks(in: roomId)
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: eyebrow(lights: lights.count, shades: shades.count, media: !media.isEmpty), title: room.name,
                     subtitle: subtitle(lights: lights, media: media), showBack: true)
            HVRoomHero(roomId: roomId)
            if !scenes.isEmpty {
                HVSection(title: "Scenes") {
                    LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                        ForEach(Array(scenes.enumerated()), id: \.element.id) { index, scene in
                            HVSceneTile(scene: scene, color: HV.sceneColors[index % HV.sceneColors.count])
                        }
                    }
                }
            }
            if !media.isEmpty {
                HVSection(title: "Media") {
                    LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                        ForEach(media) { HVZoneWidget(zone: $0) }
                    }
                }
            }
            if !(lights.isEmpty && shades.isEmpty && locks.isEmpty) {
                HVSection(title: "Accessories") {
                    HVAccessoryGrid(lights: lights, shades: shades, locks: locks)
                }
            }
            if lights.isEmpty && shades.isEmpty && media.isEmpty && locks.isEmpty && scenes.isEmpty {
                ContentUnavailableView("Nothing here yet", systemImage: Theme.roomSymbol(room.name), description: Text("This room has no lights, shades or media."))
            }
        }
    }

    private func eyebrow(lights: Int, shades: Int, media: Bool) -> String {
        var parts: [String] = []
        if lights > 0 { parts.append("\(lights) \(lights == 1 ? "light" : "lights")") }
        if shades > 0 { parts.append("\(shades) \(shades == 1 ? "shade" : "shades")") }
        if media { parts.append("media") }
        return parts.isEmpty ? "Room" : parts.joined(separator: " · ")
    }

    private func subtitle(lights: [Light], media: [MediaZone]) -> String {
        let on = lights.filter(\.isOn).count
        var parts: [String] = []
        if !lights.isEmpty { parts.append(on == 0 ? "Lights off" : "\(on) of \(lights.count) lights on") }
        for zone in media where zone.isOn { parts.append("Playing \(zone.currentSource?.name ?? "")") }
        return parts.joined(separator: " · ")
    }
}

// MARK: - Lights, shades, media, security, cameras

@MainActor
struct HVLightsPage: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let on = home.lightsOnCount
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: "Lights", title: on == 0 ? "All lights are off" : "\(on) \(on == 1 ? "light is" : "lights are") on",
                     subtitle: "\(home.lights.count) lights in \(home.rooms.count) rooms")
            HStack(spacing: 8) {
                HVQuickButton(title: "Turn all off", symbol: "lightbulb.slash") {
                    for light in home.lights { store.perform(.setLight(id: light.id, level: 0)) }
                    nav.notify("All lights off", symbol: "lightbulb.slash", color: HV.light)
                }
                HVQuickButton(title: "Turn all on", symbol: "lightbulb.fill") {
                    for light in home.lights { store.perform(.setLight(id: light.id, level: 1)) }
                    nav.notify("All lights on", symbol: "lightbulb.fill", color: HV.light)
                }
            }
            HVByRoom(ids: home.lights.map(\.roomId)) { roomId in
                HVAccessoryGrid(lights: home.lights.filter { home.knownRoomId($0.roomId) == roomId })
            }
        }
    }
}

@MainActor
struct HVShadesPage: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        let open = home.shades.filter { $0.position > 0.02 }.count
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: "Shades", title: open == 0 ? "All shades are closed" : "\(open) \(open == 1 ? "shade is" : "shades are") open",
                     subtitle: "\(home.shades.count) shades")
            HStack(spacing: 8) {
                HVQuickButton(title: "Open all", symbol: "arrow.up") { for s in home.shades { store.perform(.setShade(id: s.id, position: 1)) } }
                HVQuickButton(title: "Close all", symbol: "arrow.down") { for s in home.shades { store.perform(.setShade(id: s.id, position: 0)) } }
            }
            HVByRoom(ids: home.shades.map(\.roomId)) { roomId in
                HVAccessoryGrid(shades: home.shades.filter { home.knownRoomId($0.roomId) == roomId })
            }
        }
    }
}

@MainActor
struct HVMediaPage: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let playing = store.home.media.filter(\.isOn).count
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: "Media", title: playing == 0 ? "Nothing playing" : "Playing in \(playing) \(playing == 1 ? "room" : "rooms")")
            HVMediaBody()
        }
    }
}

/// The Media page without its header (also the Music page of Home).
@MainActor
struct HVMediaBody: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let lead = home.media.first { $0.isOn && $0.currentSource != nil }
        VStack(alignment: .leading, spacing: 28) {
            if let lead, home.media.count > 1 {
                HStack(spacing: 8) {
                    HVQuickButton(title: "Play \(lead.currentSource?.name ?? "this") everywhere", symbol: "hifispeaker.2.fill") {
                        HVAct.playEverywhere(store, nav, lead)
                    }
                    HVQuickButton(title: "Turn all off", symbol: "power") { HVAct.allMediaOff(store, nav) }
                }
            }
            if home.media.isEmpty {
                ContentUnavailableView("No media rooms", systemImage: "music.note")
            } else {
                LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                    ForEach(home.media) { HVZoneWidget(zone: $0) }
                }
            }
        }
    }
}

@MainActor
struct HVSecurityPage: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let home = store.home
        let unlocked = home.unlockedCount
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: "Security",
                     title: unlocked > 0 ? "\(unlocked) \(unlocked == 1 ? "door is" : "doors are") unlocked" : home.locks.isEmpty ? "Security" : "Everything is locked",
                     subtitle: home.security.first.map { "Alarm: \($0.mode.title)" })
            HVSecurityBody()
        }
    }
}

/// The Security page without its header (also the Security page of Home).
@MainActor
struct HVSecurityBody: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let home = store.home
        VStack(alignment: .leading, spacing: 28) {
            if !home.security.isEmpty || !home.gates.isEmpty {
                LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                    ForEach(home.security) { HVSecurityWidget(panel: $0) }
                    ForEach(home.gates) { HVGateWidget(gate: $0) }
                }
            }
            if !home.locks.isEmpty {
                HVSection(title: "Doors") { HVAccessoryGrid(locks: home.locks, showRoom: true) }
            }
            if !settings.cameras.isEmpty {
                HVSection(title: "Cameras") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                        ForEach(settings.cameras) { HVCameraTile(camera: $0) }
                    }
                }
            }
            if home.security.isEmpty && home.gates.isEmpty && home.locks.isEmpty {
                ContentUnavailableView("No security devices", systemImage: "shield")
            }
        }
    }
}

@MainActor
struct HVCamerasPage: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: "Cameras", title: "Cameras", subtitle: settings.cameras.isEmpty ? nil : "\(settings.cameras.count) live")
            HVCamerasBody()
        }
    }
}

/// The Cameras page without its header (also the Cameras page of Home).
@MainActor
struct HVCamerasBody: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            if !settings.cameras.isEmpty {
                HStack(spacing: 8) {
                    HVQuickButton(title: "Camera wall", symbol: "square.grid.2x2.fill") { nav.cameraWall = true }
                }
            }
            if settings.cameras.isEmpty {
                ContentUnavailableView("No cameras yet", systemImage: "video", description: Text("Add a camera's snapshot URL in Settings › Cameras."))
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                    ForEach(settings.cameras) { HVCameraTile(camera: $0) }
                }
            }
        }
    }
}

/// One section per room (in the system's room order), then "Other" for devices without a known room.
@MainActor
private struct HVByRoom<Content: View>: View {
    let ids: [String?]
    @ViewBuilder let content: (String?) -> Content
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let used = Set(ids.map { home.knownRoomId($0) ?? "" })
        ForEach(home.rooms.filter { used.contains($0.id) }) { room in
            HVSection(title: room.name, open: { nav.go(.room(room.id)) }) { content(room.id) }
        }
        if used.contains("") {
            HVSection(title: "Other") { content(nil) }
        }
    }
}

struct HVQuickButton: View {
    let title: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.primary)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .hvGlass(30)
        }
        .buttonStyle(HVPress())
    }
}
