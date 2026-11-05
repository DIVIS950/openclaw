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
                        Label(L("Home"), systemImage: "chevron.left").font(.body.weight(.semibold))
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
                            Text(verbatim: "\(w.temp)°").font(.body.weight(.semibold))
                            Text(L("H {high}° · L {low}°", ["high": "\(w.high)", "low": "\(w.low)"])).font(.subheadline).foregroundStyle(.secondary)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(L("{text}, {temp} degrees, high {high}, low {low}",
                                              ["text": L(w.text), "temp": "\(w.temp)", "high": "\(w.high)", "low": "\(w.low)"]))
                    }
                    HVClock(size: 62)
                }
            }
            HStack(spacing: 10) {
                if compact {
                    roundButton("square.grid.2x2", label: L("Rooms and controls")) { nav.sidebarOpen = true }
                }
                if isHome {
                    roundButton("square.and.pencil", label: L("Edit Home")) { nav.sheet = .editHome }
                }
                Button { nav.askOpen = true } label: {
                    HVOrb(size: 26).frame(width: 46, height: 46).background(.ultraThinMaterial, in: Circle())
                }
                .buttonStyle(HVPress())
                .accessibilityLabel(L("Ask Home"))
                roundButton("gearshape.fill", label: L("Settings")) { nav.sheet = .settings }
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
                ContentUnavailableView(L("No devices yet"), systemImage: "house", description: Text(L("Open Settings to connect your Crestron system.")))
            }
            Button { nav.sheet = .editHome } label: {
                Label(L("Edit Home"), systemImage: "square.and.pencil")
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
            if part.isWidget && !isWide(part, home) {
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

    /// Several alarm zones or gates get one full-width card instead of a widget each.
    private func isWide(_ part: HomePart, _ home: HomeSnapshot) -> Bool {
        switch part {
        case .gate: return home.gates.count > 1
        case .alarm: return home.security.count > 1
        default: return false
        }
    }

    private func shows(_ part: HomePart, _ home: HomeSnapshot) -> Bool {
        switch part {
        case .status:
            return !(home.lights.isEmpty && home.security.isEmpty && home.locks.isEmpty && home.gates.isEmpty
                && home.shades.isEmpty && home.media.isEmpty && home.climate.isEmpty)
        case .weather, .favorites, .upcoming, .rooms: return true
        case .gate: return !home.gates.isEmpty
        case .alarm: return !home.security.isEmpty
        case .heating: return home.hasHeating
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
        case .heating: HVHeatingSummaryWidget()
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
        case .gate:
            HVArrivalWidget()
        case .alarm:
            HVZonesWidget()
        case .favorites:
            HVFavoritesPart()
        case .scenes:
            HVSection(title: L("Scenes")) {
                LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                    ForEach(home.homeScenes) { scene in
                        HVSceneTile(scene: scene, color: HV.sceneColor(scene, in: home))
                    }
                }
            }
        case .upcoming:
            HVUpcomingPart()
        case .cameras:
            HVSection(title: L("Cameras"), open: { nav.go(.cameras) }) {
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
            let climate = home.climate(in: room.id), switches = home.switches(in: room.id)
            if !(lights.isEmpty && shades.isEmpty && media.isEmpty && locks.isEmpty && climate.isEmpty && switches.isEmpty) {
                HVSection(title: room.name, open: { nav.go(.room(room.id)) }) {
                    HVAccessoryGrid(climate: climate, lights: lights, shades: shades, media: media, locks: locks, switches: switches)
                }
            }
        }
        let known = { (id: String?) in home.knownRoomId(id) != nil }
        let otherLights = home.lights.filter { !known($0.roomId) }, otherShades = home.shades.filter { !known($0.roomId) }
        let otherMedia = home.media.filter { !known($0.roomId) }, otherLocks = home.locks.filter { !known($0.roomId) }
        if !(otherLights.isEmpty && otherShades.isEmpty && otherMedia.isEmpty && otherLocks.isEmpty) {
            HVSection(title: L("Other")) {
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
        let room = home.room(roomId) ?? Room(id: roomId, name: L("Room"))
        let lights = home.lights(in: roomId), shades = home.shades(in: roomId)
        let scenes = home.scenes(in: roomId), media = home.media(in: roomId), locks = home.locks(in: roomId)
        let climate = home.climate(in: roomId), switches = home.switches(in: roomId)
        VStack(alignment: .leading, spacing: 28) {
            HVHeader(eyebrow: eyebrow(lights: lights.count, shades: shades.count, media: !media.isEmpty), title: room.name,
                     subtitle: subtitle(lights: lights, media: media), showBack: true)
            HVRoomHero(roomId: roomId)
            if !scenes.isEmpty {
                HVSection(title: L("Scenes")) {
                    LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                        ForEach(Array(scenes.enumerated()), id: \.element.id) { index, scene in
                            HVSceneTile(scene: scene, color: HV.sceneColors[index % HV.sceneColors.count])
                        }
                    }
                }
            }
            if !media.isEmpty {
                HVSection(title: L("Media")) {
                    LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                        ForEach(media) { HVZoneWidget(zone: $0) }
                    }
                }
            }
            if !(lights.isEmpty && shades.isEmpty && locks.isEmpty && climate.isEmpty && switches.isEmpty) {
                HVSection(title: L("Accessories")) {
                    HVAccessoryGrid(climate: climate, lights: lights, shades: shades, locks: locks, switches: switches)
                }
            }
            if lights.isEmpty && shades.isEmpty && media.isEmpty && locks.isEmpty && scenes.isEmpty && climate.isEmpty && switches.isEmpty {
                ContentUnavailableView(L("Nothing here yet"), systemImage: Theme.roomSymbol(room.name), description: Text(L("This room has no lights, shades or media.")))
            }
        }
    }

    private func eyebrow(lights: Int, shades: Int, media: Bool) -> String {
        var parts: [String] = []
        if lights > 0 { parts.append(Ln(lights, "{n} light", "{n} lights")) }
        if shades > 0 { parts.append(Ln(shades, "{n} shade", "{n} shades")) }
        if media { parts.append(L("media")) }
        return parts.isEmpty ? L("Room") : parts.joined(separator: " · ")
    }

    private func subtitle(lights: [Light], media: [MediaZone]) -> String {
        let on = lights.filter(\.isOn).count
        var parts: [String] = []
        if !lights.isEmpty { parts.append(on == 0 ? L("Lights off") : L("{on} of {all} lights on", ["on": String(on), "all": String(lights.count)])) }
        for zone in media where zone.isOn { parts.append(L("Playing {name}", ["name": zone.currentSource?.name ?? ""])) }
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
            HVHeader(eyebrow: L("Lights"), title: on == 0 ? L("All lights are off") : Ln(on, "{n} light is on", "{n} lights are on"),
                     subtitle: L("{lights} in {rooms}", ["lights": Ln(home.lights.count, "{n} light", "{n} lights"),
                                                         "rooms": Ln(home.rooms.count, "{n} room", "{n} rooms")]))
            HStack(spacing: 8) {
                HVQuickButton(title: L("Turn all off"), symbol: "lightbulb.slash") {
                    for light in home.lights { store.perform(.setLight(id: light.id, level: 0)) }
                    nav.notify(L("All lights off"), symbol: "lightbulb.slash", color: HV.light)
                }
                HVQuickButton(title: L("Turn all on"), symbol: "lightbulb.fill") {
                    for light in home.lights { store.perform(.setLight(id: light.id, level: 1)) }
                    nav.notify(L("All lights on"), symbol: "lightbulb.fill", color: HV.light)
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
            HVHeader(eyebrow: L("Shades"), title: open == 0 ? L("All shades are closed") : Ln(open, "{n} shade is open", "{n} shades are open"),
                     subtitle: Ln(home.shades.count, "{n} shade", "{n} shades"))
            HStack(spacing: 8) {
                HVQuickButton(title: L("Open all"), symbol: "arrow.up") { for s in home.shades { store.perform(.setShade(id: s.id, position: 1)) } }
                HVQuickButton(title: L("Close all"), symbol: "arrow.down") { for s in home.shades { store.perform(.setShade(id: s.id, position: 0)) } }
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
            HVHeader(eyebrow: L("Media"), title: playing == 0 ? L("Nothing playing") : L("Playing in {rooms}", ["rooms": Ln(playing, "{n} room", "{n} rooms")]))
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
                    HVQuickButton(title: L("Play {name} everywhere", ["name": lead.currentSource?.name ?? L("this")]), symbol: "hifispeaker.2.fill") {
                        HVAct.playEverywhere(store, nav, lead)
                    }
                    HVQuickButton(title: L("Turn all off"), symbol: "power") { HVAct.allMediaOff(store, nav) }
                }
            }
            if home.media.isEmpty {
                ContentUnavailableView(L("No media rooms"), systemImage: "music.note")
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
            HVHeader(eyebrow: L("Security"),
                     title: unlocked > 0 ? Ln(unlocked, "{n} door is unlocked", "{n} doors are unlocked") : home.locks.isEmpty ? L("Security") : L("Everything is locked"),
                     subtitle: subtitle(home))
            HVSecurityBody()
        }
    }

    private func subtitle(_ home: HomeSnapshot) -> String? {
        if home.security.count > 1 {
            return L("{armed}/{all} zones armed", ["armed": String(home.armedZoneCount), "all": String(home.security.count)])
        }
        return home.security.first.map { L("Alarm: {mode}", ["mode": $0.mode.label]) }
    }
}

/// The Security page without its header (also the Security page of Home).
@MainActor
struct HVSecurityBody: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings

    var body: some View {
        let home = store.home
        // Several zones or gates share one card; a single alarm or gate keeps its own widget.
        let panels = home.security.count == 1 ? home.security : []
        let gates = home.gates.count == 1 ? home.gates : []
        VStack(alignment: .leading, spacing: 28) {
            if home.security.count > 1 { HVZonesWidget() }
            if home.gates.count > 1 { HVArrivalWidget() }
            if !panels.isEmpty || !gates.isEmpty {
                LazyVGrid(columns: HV.widgetColumns, spacing: 14) {
                    ForEach(panels) { HVSecurityWidget(panel: $0) }
                    ForEach(gates) { HVGateWidget(gate: $0) }
                }
            }
            if !home.locks.isEmpty {
                HVSection(title: L("Doors")) { HVAccessoryGrid(locks: home.locks, showRoom: true) }
            }
            if !settings.cameras.isEmpty {
                HVSection(title: L("Cameras")) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 300), spacing: 14)], spacing: 14) {
                        ForEach(settings.cameras) { HVCameraTile(camera: $0) }
                    }
                }
            }
            if home.security.isEmpty && home.gates.isEmpty && home.locks.isEmpty {
                ContentUnavailableView(L("No security devices"), systemImage: "shield")
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
            HVHeader(eyebrow: L("Cameras"), title: L("Cameras"), subtitle: settings.cameras.isEmpty ? nil : L("{n} live", ["n": String(settings.cameras.count)]))
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
                    HVQuickButton(title: L("Camera wall"), symbol: "square.grid.2x2.fill") { nav.cameraWall = true }
                }
            }
            if settings.cameras.isEmpty {
                ContentUnavailableView(L("No cameras yet"), systemImage: "video", description: Text(L("Add a camera's snapshot URL in Settings › Cameras.")))
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
            HVSection(title: L("Other")) { content(nil) }
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
