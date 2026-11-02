import SwiftUI
import UIKit

// Home View extras: the weather widget, favorites, Edit Home, the camera wall and the
// doorbell pop-up.

// MARK: - Weather

@MainActor
struct HVWeatherWidget: View {
    @Environment(WeatherStore.self) private var weather
    @Environment(AppSettings.self) private var settings
    @Environment(HVNav.self) private var nav

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let location = settings.effectiveLocation {
                if let w = weather.weather {
                    HVWidgetTop(symbol: w.symbol, color: w.isDay ? .orange : .indigo, name: location.place, state: w.text)
                        // Room for the drawing at the top right.
                        .padding(.trailing, 92)
                    HStack(alignment: .center, spacing: 14) {
                        Text("\(w.temp)°")
                            .font(.system(size: 58, weight: .light))
                            .monospacedDigit()
                            .tracking(-1.5)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("H \(w.high)°")
                            Text("L \(w.low)°")
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                    }
                    Spacer(minLength: 0)
                    if let sun = Sun.times(on: Date(), lat: location.lat, lon: location.lon) {
                        HStack(spacing: 14) {
                            Label(sun.sunrise.formatted(date: .omitted, time: .shortened), systemImage: "sunrise.fill")
                                .accessibilityLabel("Sunrise \(sun.sunrise.formatted(date: .omitted, time: .shortened))")
                            Label(sun.sunset.formatted(date: .omitted, time: .shortened), systemImage: "sunset.fill")
                                .accessibilityLabel("Sunset \(sun.sunset.formatted(date: .omitted, time: .shortened))")
                        }
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.secondary)
                    }
                } else {
                    HVWidgetTop(symbol: "cloud.sun.fill", color: .blue, name: location.place, state: "Weather is loading…")
                }
            } else {
                HVWidgetTop(symbol: "cloud.sun.fill", color: .blue, name: "Weather", state: "Add your town")
                Text("Weather, sunrise and sunset, and schedules that follow the sun.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
                HVWideButton(title: "Set location", symbol: "gearshape.fill", tint: .blue, primary: true) { nav.sheet = .settings }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .topTrailing) {
            if settings.effectiveLocation != nil, let w = weather.weather {
                HVWeatherArt(kind: HVWeatherArt.Kind(code: w.code, isDay: w.isDay), night: !w.isDay)
                    .offset(x: 8, y: -10)
            }
        }
        .hvWidget()
    }
}

// MARK: - Favorites

/// A favorite that still exists in the house.
enum HVFavorite: Identifiable {
    case light(Light), shade(Shade), media(MediaZone), lock(DoorLock), scene(HomeScene)

    var id: String {
        switch self {
        case let .light(x): FavoriteKind.light.key(x.id)
        case let .shade(x): FavoriteKind.shade.key(x.id)
        case let .media(x): FavoriteKind.media.key(x.id)
        case let .lock(x): FavoriteKind.lock.key(x.id)
        case let .scene(x): FavoriteKind.scene.key(x.id)
        }
    }

    /// In the order they were added; removed devices are left out.
    static func items(_ keys: [String], home: HomeSnapshot) -> [HVFavorite] {
        keys.compactMap { key -> HVFavorite? in
            guard let colon = key.firstIndex(of: ":"),
                  let kind = FavoriteKind(rawValue: String(key[..<colon])) else { return nil }
            let id = String(key[key.index(after: colon)...])
            switch kind {
            case .light: return home.lights.first { $0.id == id }.map { HVFavorite.light($0) }
            case .shade: return home.shades.first { $0.id == id }.map { HVFavorite.shade($0) }
            case .media: return home.media.first { $0.id == id }.map { HVFavorite.media($0) }
            case .lock: return home.locks.first { $0.id == id }.map { HVFavorite.lock($0) }
            case .scene: return home.scenes.first { $0.id == id }.map { HVFavorite.scene($0) }
            }
        }
    }
}

/// The Favorites section on Home.
@MainActor
struct HVFavoritesPart: View {
    @Environment(HomeStore.self) private var store
    @Environment(HomeLayout.self) private var layout
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let items = HVFavorite.items(layout.favorites, home: home)
        if items.isEmpty {
            HVSection(title: "Favorites") {
                HVEmptyRow(symbol: "star", title: "Add your favorites",
                           text: "Tap the star on any light, shade, music room or lock, or choose them here.",
                           buttonTitle: "Choose") { nav.sheet = .favorites }
            }
        } else {
            HVSection(title: "Favorites", actionTitle: "Edit", action: { nav.sheet = .favorites }) {
                LazyVGrid(columns: HV.tileColumns, spacing: 12) {
                    ForEach(items) { item in
                        switch item {
                        case let .light(light): HVLightTile(light: light, room: home.room(light.roomId)?.name)
                        case let .shade(shade): HVShadeTile(shade: shade, room: home.room(shade.roomId)?.name)
                        case let .media(zone): HVMediaTile(zone: zone, room: home.room(zone.roomId)?.name)
                        case let .lock(lock): HVLockTile(lock: lock, room: home.room(lock.roomId)?.name)
                        case let .scene(scene): HVSceneTile(scene: scene, color: HV.sceneColor(scene, in: home))
                        }
                    }
                }
            }
        }
    }
}

/// Frosted row for an empty section: an icon, a short explanation and a button.
struct HVEmptyRow: View {
    let symbol: String
    let title: String
    let text: String
    var buttonTitle: String?
    var action: (() -> Void)?

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.secondary)
                .frame(width: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.semibold))
                Text(text).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let buttonTitle, let action {
                Button(action: action) {
                    Label(buttonTitle, systemImage: "plus")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.primary)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Capsule().fill(Color.primary.opacity(0.08)))
                }
                .buttonStyle(HVPress())
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .hvGlass(22)
    }
}

/// Grouped list used by the list sheets (Edit Home, Favorites, schedule editor).
struct HVListBox<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(spacing: 0) { content }
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.07)))
    }
}

struct HVListLabel: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.footnote.weight(.semibold))
            .tracking(0.6)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.top, 6)
    }
}

/// Small colored square with a symbol, at the start of a list row.
struct HVRowIcon: View {
    let symbol: String
    let color: Color

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 30, height: 30)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(color))
    }
}

/// Pick favorites, grouped by room.
@MainActor
struct HVFavoritesSheet: View {
    @Environment(HomeStore.self) private var store
    @Environment(HomeLayout.self) private var layout
    @Environment(HVNav.self) private var nav

    private struct Row: Identifiable {
        let key: String
        let name: String
        let symbol: String
        var id: String { key }
    }

    private struct RowGroup: Identifiable {
        let title: String
        let rows: [Row]
        var id: String { title }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HVSheetHeader(symbol: "star.fill", color: HV.light, title: "Favorites", subtitle: "Tap to add or remove")
                ForEach(groups) { group in
                    HVListLabel(text: group.title)
                    HVListBox {
                        ForEach(group.rows) { row in
                            let on = layout.isFavorite(row.key)
                            Button { _ = layout.toggleFavorite(row.key) } label: {
                                HStack(spacing: 12) {
                                    HVRowIcon(symbol: row.symbol, color: on ? HV.light : .gray)
                                    Text(row.name).font(.body)
                                    Spacer(minLength: 8)
                                    Image(systemName: on ? "star.fill" : "star")
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(on ? HV.light : Color.secondary)
                                }
                                .padding(.horizontal, 14)
                                .frame(minHeight: 50)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(row.name)
                            .accessibilityAddTraits(on ? .isSelected : [])
                            if row.id != group.rows.last?.id { Divider().padding(.leading, 56) }
                        }
                    }
                }
                if groups.isEmpty {
                    Text("No devices yet.").font(.body).foregroundStyle(.secondary).frame(maxWidth: .infinity)
                }
                HVWideButton(title: "Done", symbol: "checkmark", tint: .blue, primary: true) { nav.sheet = nil }
            }
            .hvCard()
        }
    }

    private var groups: [RowGroup] {
        let home = store.home
        func rows(_ roomId: String?) -> [Row] {
            let inRoom = { (id: String?) -> Bool in
                roomId == nil ? home.knownRoomId(id) == nil : id == roomId
            }
            var list: [Row] = []
            list += home.scenes.filter { inRoom($0.roomId) }
                .map { Row(key: FavoriteKind.scene.key($0.id), name: $0.name, symbol: Theme.sceneSymbol($0)) }
            list += home.lights.filter { inRoom($0.roomId) }
                .map { Row(key: FavoriteKind.light.key($0.id), name: $0.name, symbol: "lightbulb.fill") }
            list += home.shades.filter { inRoom($0.roomId) }
                .map { Row(key: FavoriteKind.shade.key($0.id), name: $0.name, symbol: "blinds.horizontal.closed") }
            list += home.media.filter { inRoom($0.roomId) }
                .map { Row(key: FavoriteKind.media.key($0.id), name: home.tileName($0), symbol: HV.symbol(for: $0)) }
            list += home.locks.filter { inRoom($0.roomId) }
                .map { Row(key: FavoriteKind.lock.key($0.id), name: $0.name, symbol: "lock.fill") }
            return list
        }
        // Whole-house scenes and devices without a known room first, then each room.
        var result: [RowGroup] = []
        let house = rows(nil)
        if !house.isEmpty { result.append(RowGroup(title: "Whole house", rows: house)) }
        for room in home.rooms {
            let list = rows(room.id)
            if !list.isEmpty { result.append(RowGroup(title: room.name, rows: list)) }
        }
        return result
    }
}

// MARK: - Edit Home

@MainActor
struct HVEditHomeSheet: View {
    @Environment(HomeLayout.self) private var layout
    @Environment(HVNav.self) private var nav

    var body: some View {
        let parts = layout.parts
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HVSheetHeader(symbol: "square.and.pencil", color: .blue, title: "Edit Home", subtitle: "Choose what this iPad shows on Home")
                HVListLabel(text: "On Home")
                HVListBox {
                    if parts.isEmpty {
                        Text("Nothing yet. Add something below.")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, minHeight: 50)
                    }
                    ForEach(Array(parts.enumerated()), id: \.element) { index, part in
                        HStack(spacing: 10) {
                            Button { withAnimation { layout.remove(part) } } label: {
                                Image(systemName: "minus.circle.fill")
                                    .font(.title2)
                                    .symbolRenderingMode(.palette)
                                    .foregroundStyle(.white, .red)
                            }
                            .buttonStyle(HVPress())
                            .accessibilityLabel("Remove \(part.name)")
                            HVRowIcon(symbol: part.symbol, color: .blue)
                            partText(part)
                            Spacer(minLength: 8)
                            moveButton("chevron.up", label: "Move \(part.name) up", disabled: index == 0) { layout.move(part, by: -1) }
                            moveButton("chevron.down", label: "Move \(part.name) down", disabled: index == parts.count - 1) { layout.move(part, by: 1) }
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 60)
                        if index < parts.count - 1 { Divider().padding(.leading, 56) }
                    }
                }
                let hidden = layout.hidden
                if !hidden.isEmpty {
                    HVListLabel(text: "More to add")
                    HVListBox {
                        ForEach(hidden) { part in
                            HStack(spacing: 10) {
                                Button { withAnimation { layout.add(part) } } label: {
                                    Image(systemName: "plus.circle.fill")
                                        .font(.title2)
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, .green)
                                }
                                .buttonStyle(HVPress())
                                .accessibilityLabel("Add \(part.name)")
                                HVRowIcon(symbol: part.symbol, color: .gray)
                                partText(part)
                                Spacer(minLength: 8)
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 60)
                            if part != hidden.last { Divider().padding(.leading, 56) }
                        }
                    }
                }
                HVListBox {
                    Button { nav.sheet = .favorites } label: {
                        HStack(spacing: 10) {
                            HVRowIcon(symbol: "star.fill", color: HV.light)
                            VStack(alignment: .leading, spacing: 1) {
                                Text("Choose favorites").font(.body)
                                Text(layout.favorites.isEmpty ? "None yet" : "\(layout.favorites.count) chosen")
                                    .font(.footnote).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(.tertiary)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 56)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                HStack(spacing: 10) {
                    HVWideButton(title: "Reset to standard", symbol: "arrow.counterclockwise") { withAnimation { layout.reset() } }
                    HVWideButton(title: "Done", symbol: "checkmark", tint: .blue, primary: true) { nav.sheet = nil }
                }
            }
            .hvCard()
        }
    }

    private func partText(_ part: HomePart) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(part.name).font(.body)
            Text(part.about).font(.footnote).foregroundStyle(.secondary).lineLimit(2)
        }
    }

    private func moveButton(_ symbol: String, label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button { withAnimation { action() } } label: {
            Image(systemName: symbol)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.primary)
                .frame(width: 34, height: 34)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(0.08)))
        }
        .buttonStyle(HVPress())
        .disabled(disabled)
        .opacity(disabled ? 0.3 : 1)
        .accessibilityLabel(label)
    }
}

// MARK: - Camera wall

/// Every camera at once on black, filling the screen.
@MainActor
struct HVCameraWall: View {
    let cameras: [CameraConfig]
    let onClose: () -> Void

    var body: some View {
        GeometryReader { geo in
            let count = max(1, cameras.count)
            let columns = min(3, Int(Double(count).squareRoot().rounded(.up)))
            let rows = Int((Double(count) / Double(columns)).rounded(.up))
            let gap: CGFloat = 8
            let height = max(140, (geo.size.height - gap * CGFloat(rows - 1)) / CGFloat(rows))
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: gap), count: columns), spacing: gap) {
                    ForEach(cameras) { camera in
                        CameraSnapshotView(camera: camera)
                            .frame(height: height)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(alignment: .bottomLeading) {
                                HStack(spacing: 7) {
                                    Circle().fill(.red).frame(width: 7, height: 7)
                                    Text(camera.name).font(.footnote.weight(.semibold))
                                }
                                .foregroundStyle(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(.black.opacity(0.4), in: Capsule())
                                .padding(12)
                            }
                            .accessibilityElement(children: .ignore)
                            .accessibilityLabel("\(camera.name) camera")
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .padding(10)
        .background(Color.black.ignoresSafeArea())
        .overlay(alignment: .top) {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                Text(context.date.formatted(date: .omitted, time: .standard))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(.black.opacity(0.45), in: Capsule())
            }
            .padding(.top, 22)
        }
        .overlay(alignment: .topTrailing) {
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(HVPress())
            .padding(22)
            .accessibilityLabel("Close camera wall")
        }
        .environment(\.colorScheme, .dark)
        .statusBarHidden()
    }
}

// MARK: - Doorbell

/// Shown over everything when someone rings: the door camera, hold to unlock, Dismiss.
@MainActor
struct HVDoorbellCard: View {
    let alert: HVNav.DoorbellAlert
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(HVNav.self) private var nav

    var body: some View {
        let home = store.home
        let bell = home.doorbells.first { $0.id == alert.id }
        let camera = settings.cameras.first { $0.name == bell?.cameraName } ?? settings.cameras.first
        let lock = home.locks.first { $0.id == bell?.lockId }
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 14) {
                    Image(systemName: "bell.fill")
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.pink))
                        .symbolEffect(.bounce, options: .repeat(3), value: alert.ringAt)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(bell?.name ?? "Doorbell").font(.title2.weight(.bold))
                        Text("Someone is at the door · \(alert.ringAt.formatted(date: .omitted, time: .shortened))")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                }
                Group {
                    if let camera {
                        CameraSnapshotView(camera: camera, interval: .milliseconds(500))
                    } else {
                        ZStack {
                            Color.black
                            VStack(spacing: 8) {
                                Image(systemName: "video.slash").font(.title)
                                Text("No camera linked to this doorbell").font(.footnote)
                            }
                            .foregroundStyle(.white.opacity(0.6))
                        }
                    }
                }
                .aspectRatio(16 / 9, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                HStack(spacing: 28) {
                    if let lock, lock.isLocked != false {
                        VStack(spacing: 8) {
                            HVHoldButton(symbol: "lock.fill", tint: .green, label: "Unlock \(lock.name)") {
                                store.perform(.setLock(id: lock.id, locked: false))
                                nav.notify("\(lock.name) unlocked", symbol: "lock.open.fill", color: .orange)
                                nav.doorbell = nil
                            }
                            Text("Hold to unlock \(lock.name)").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
                        }
                    }
                    HVWideButton(title: "Dismiss", symbol: "xmark") { nav.doorbell = nil }
                        .frame(maxWidth: 200)
                }
                .frame(maxWidth: .infinity)
            }
            .padding(20)
            .frame(maxWidth: 760)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 36, style: .continuous))
            .shadow(color: .black.opacity(0.35), radius: 40, y: 20)
            .padding(16)
        }
        .accessibilityAddTraits(.isModal)
    }
}
