import PhotosUI
import SwiftUI

// The Rooms page of Home (a big card per room) and the hero card at the top of a room.
// Both show the room photo, or the room's two colors, with a warm glow as bright as its lights.

/// What is going on in one room.
struct HVRoomStats {
    let lights: [Light]
    let on: [Light]
    /// Average brightness of all the room's lights, 0...1.
    let average: Double
    let shades: [Shade]
    let media: [MediaZone]
    let locks: [DoorLock]

    init(_ home: HomeSnapshot, _ roomId: String) {
        let lights = home.lights(in: roomId)
        self.lights = lights
        on = lights.filter(\.isOn)
        let total = lights.reduce(0.0) { $0 + $1.level }
        average = lights.isEmpty ? 0 : total / Double(lights.count)
        shades = home.shades(in: roomId)
        media = home.media(in: roomId)
        locks = home.locks(in: roomId)
    }

    var openShades: Int { shades.filter { $0.position > 0.02 }.count }
    var unlocked: Int { locks.filter { $0.isLocked == false }.count }
    var playing: MediaZone? { media.first(where: \.isOn) }

    /// "1 of 3 lights on · Playing Blue in Green", or "Nothing on".
    var status: String {
        var parts: [String] = []
        if !lights.isEmpty { parts.append(on.isEmpty ? "Lights off" : "\(on.count) of \(lights.count) lights on") }
        if let playing { parts.append("Playing \(Self.playingText(playing))") }
        return parts.isEmpty ? "Nothing on" : parts.joined(separator: " · ")
    }

    /// The song when the system sends it, else the source.
    static func playingText(_ zone: MediaZone) -> String {
        if let title = zone.nowPlaying?.title, !title.isEmpty { return title }
        return zone.currentSource?.name ?? "On"
    }
}

// MARK: - Rooms page

/// The Rooms page of Home: quick buttons for the whole house, then a card per room.
@MainActor
struct HVRoomsBody: View {
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav
    @Environment(\.hvCompact) private var compact

    var body: some View {
        let home = store.home
        VStack(alignment: .leading, spacing: 22) {
            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    if !home.lights.isEmpty {
                        HVQuickButton(title: "All lights off", symbol: "lightbulb.slash") {
                            for light in store.home.lights { store.perform(.setLight(id: light.id, level: 0)) }
                            nav.notify("All lights off", symbol: "lightbulb.slash", color: HV.light)
                        }
                    }
                    if !home.shades.isEmpty {
                        HVQuickButton(title: "Close all shades", symbol: "arrow.down") {
                            for shade in store.home.shades { store.perform(.setShade(id: shade.id, position: 0)) }
                            nav.notify("Closing all shades", symbol: "blinds.horizontal.closed", color: HV.shade)
                        }
                    }
                    if home.media.contains(where: \.isOn) {
                        HVQuickButton(title: "All music off", symbol: "power") { HVAct.allMediaOff(store, nav) }
                    }
                }
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 270), spacing: 16)], spacing: 16) {
                ForEach(home.rooms) { room in
                    HVRoomCard(room: room, aspect: compact ? 16 / 10 : 4 / 3)
                }
            }
        }
    }
}

/// A big room card: photo or colors, the light glow, a quick lights button, name, status and badges.
@MainActor
struct HVRoomCard: View {
    let room: Room
    var aspect: CGFloat = 4 / 3
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav

    var body: some View {
        let stats = HVRoomStats(store.home, room.id)
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        ZStack(alignment: .topTrailing) {
            Button { nav.go(.room(room.id)) } label: {
                face(stats)
                    .aspectRatio(aspect, contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .background { HVRoomBackdrop(roomId: room.id, glow: stats.average, lit: !stats.on.isEmpty) }
                    .clipShape(shape)
                    .contentShape(shape)
            }
            .buttonStyle(HVPress())
            .accessibilityLabel("\(room.name): \(stats.status)")
            .accessibilityHint("Opens the room")

            if !stats.lights.isEmpty {
                quickLights(stats)
                    .padding(16)
            }
        }
        .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
        .hvTilt(3.5)
    }

    private func face(_ stats: HVRoomStats) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Image(systemName: Theme.roomSymbol(room.name))
                .font(.system(size: 21, weight: .semibold))
                .frame(width: 44, height: 44)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.22)))
            Spacer(minLength: 8)
            VStack(alignment: .leading, spacing: 3) {
                Text(room.name)
                    .font(.system(size: 22, weight: .bold))
                    .tracking(-0.3)
                    .lineLimit(1)
                    .shadow(color: .black.opacity(0.25), radius: 6, y: 1)
                Text(stats.status)
                    .font(.subheadline.weight(.medium))
                    .opacity(0.9)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.25), radius: 6, y: 1)
                badges(stats)
                    .padding(.top, 6)
            }
        }
        .foregroundStyle(.white)
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func badges(_ stats: HVRoomStats) -> some View {
        HVFlow(spacing: 6) {
            if !stats.shades.isEmpty {
                badge(stats.openShades > 0 ? "blinds.horizontal.open" : "blinds.horizontal.closed",
                      stats.openShades > 0 ? "\(stats.openShades) open" : "Closed")
            }
            if let playing = stats.playing {
                badge("music.note", playing.currentSource?.name ?? "On")
            }
            if !stats.locks.isEmpty {
                let unlocked = stats.unlocked > 0
                badge(unlocked ? "lock.open.fill" : "lock.fill", unlocked ? "Unlocked" : "Locked", attention: unlocked)
            }
        }
    }

    private func badge(_ symbol: String, _ text: String, attention: Bool = false) -> some View {
        Label(text, systemImage: symbol)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Capsule().fill(attention ? Color.orange : Color.white.opacity(0.22)))
    }

    private func quickLights(_ stats: HVRoomStats) -> some View {
        let on = !stats.on.isEmpty
        return Button {
            for light in stats.lights { store.perform(.setLight(id: light.id, level: on ? 0 : 1)) }
            nav.notify("\(room.name) lights \(on ? "off" : "on")", symbol: on ? "lightbulb.slash" : "lightbulb.fill", color: HV.light)
        } label: {
            Image(systemName: on ? "lightbulb.fill" : "lightbulb.slash")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(on ? Color(red: 0.9, green: 0.58, blue: 0) : Color.white)
                .frame(width: 44, height: 44)
                .background(Circle().fill(on ? Color.white : Color.black.opacity(0.28)))
                .shadow(color: on ? Color(red: 1, green: 0.77, blue: 0.27).opacity(0.8) : .clear, radius: 11)
                .contentShape(Circle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel("\(room.name): lights \(on ? "off" : "on")")
    }
}

// MARK: - Backdrop

/// The room photo (darkened at the bottom), or a gradient from the room's two colors,
/// with the warm light glow on top.
@MainActor
struct HVRoomBackdrop: View {
    let roomId: String
    /// Average light level, 0...1.
    let glow: Double
    let lit: Bool
    @Environment(HomeStore.self) private var store
    @Environment(RoomPhotos.self) private var photos

    var body: some View {
        let hues = HV.roomHuePalette(store.home, roomId)
        ZStack {
            if let photo = photos.image(for: roomId) {
                Color.clear
                    .overlay {
                        Image(uiImage: photo)
                            .resizable()
                            .scaledToFill()
                    }
                    .clipped()
                LinearGradient(colors: [.black.opacity(0.1), .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
            } else {
                LinearGradient(colors: [HV.hsl(hues[0], 0.70, 0.58), HV.hsl(hues[1], 0.62, 0.38)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                EllipticalGradient(colors: [.white.opacity(0.25), .clear], center: UnitPoint(x: 0.85, y: 0.1),
                                   startRadiusFraction: 0, endRadiusFraction: 0.45)
                LinearGradient(colors: [.clear, .black.opacity(0.32)], startPoint: UnitPoint(x: 0.5, y: 0.4), endPoint: .bottom)
            }
            HVRoomGlow(level: glow, lit: lit)
        }
        .accessibilityHidden(true)
    }
}

/// Warm light pooling from the ceiling, as bright as the room's lights; it breathes while lit.
struct HVRoomGlow: View {
    let level: Double
    let lit: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let glow = EllipticalGradient(colors: [Color(red: 1, green: 0.78, blue: 0.35).opacity(0.85), .clear],
                                      center: UnitPoint(x: 0.5, y: -0.05), startRadiusFraction: 0, endRadiusFraction: 0.75)
        let strength = level.clamped01 * 0.95
        Group {
            if lit && !reduceMotion {
                Rectangle().fill(glow)
                    .phaseAnimator([false, true]) { view, up in
                        view.opacity(up ? strength : strength * 0.8)
                    } animation: { _ in
                        .easeInOut(duration: 2.5)
                    }
            } else {
                Rectangle().fill(glow).opacity(strength)
            }
        }
        .animation(.easeInOut(duration: 0.8), value: strength)
        .allowsHitTesting(false)
    }
}

// MARK: - Room hero

/// The card at the top of a room: photo or colors with the glow, live stats, and the
/// room's quick buttons.
@MainActor
struct HVRoomHero: View {
    let roomId: String
    @Environment(HomeStore.self) private var store
    @Environment(RoomPhotos.self) private var photos
    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        let stats = HVRoomStats(store.home, roomId)
        let shape = RoundedRectangle(cornerRadius: 28, style: .continuous)
        VStack(alignment: .leading, spacing: 18) {
            if !stats.lights.isEmpty || !stats.shades.isEmpty || !stats.media.isEmpty || !stats.locks.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                    if !stats.lights.isEmpty {
                        stat("lightbulb.fill", HV.light, "Lights", stats.on.isEmpty ? "Off" : "\(stats.on.count) on · \(stats.average.percentText)")
                    }
                    if !stats.shades.isEmpty {
                        stat("blinds.horizontal.closed", HV.shade, "Shades", stats.openShades > 0 ? "\(stats.openShades) open" : "Closed")
                    }
                    if !stats.media.isEmpty {
                        stat("music.note", HV.media, "Music", stats.playing.map(HVRoomStats.playingText) ?? "Off")
                    }
                    if !stats.locks.isEmpty {
                        let unlocked = stats.unlocked > 0
                        stat(unlocked ? "lock.open.fill" : "lock.fill", unlocked ? .orange : .green, "Door", unlocked ? "Unlocked" : "Locked")
                    }
                }
            }
            ScrollView(.horizontal) {
                HStack(spacing: 8) { quickButtons(stats) }
                    .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
        .foregroundStyle(.white)
        .padding(22)
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .bottomLeading)
        .background { HVRoomBackdrop(roomId: roomId, glow: stats.average, lit: !stats.on.isEmpty) }
        .clipShape(shape)
        .shadow(color: .black.opacity(0.18), radius: 16, y: 8)
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    photos.setImage(data, for: roomId)
                }
                photoItem = nil
            }
        }
    }

    @ViewBuilder
    private func quickButtons(_ stats: HVRoomStats) -> some View {
        let anyOn = !stats.on.isEmpty
        if !stats.lights.isEmpty {
            capsule(anyOn ? "Lights off" : "Lights on", anyOn ? "lightbulb.slash" : "lightbulb.fill") {
                for light in stats.lights { store.perform(.setLight(id: light.id, level: anyOn ? 0 : 1)) }
            }
        }
        if !stats.shades.isEmpty {
            capsule("Open shades", "arrow.up") { for shade in stats.shades { store.perform(.setShade(id: shade.id, position: 1)) } }
            capsule("Close shades", "arrow.down") { for shade in stats.shades { store.perform(.setShade(id: shade.id, position: 0)) } }
        }
        let hasPhoto = photos.image(for: roomId) != nil
        PhotosPicker(selection: $photoItem, matching: .images) {
            capsuleLabel(hasPhoto ? "Change photo" : "Room photo", "photo")
        }
        .buttonStyle(HVPress())
        if hasPhoto {
            capsule("Remove photo", "xmark") { photos.removeImage(for: roomId) }
        }
    }

    private func stat(_ symbol: String, _ color: Color, _ title: String, _ value: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 36, height: 36)
                .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(color))
            VStack(alignment: .leading, spacing: 1) {
                Text(title.uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(0.5)
                    .opacity(0.85)
                Text(value)
                    .font(.callout.weight(.bold))
                    .lineLimit(1)
                    .contentTransition(.numericText())
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.white.opacity(0.18)))
        .accessibilityElement(children: .combine)
    }

    private func capsule(_ title: String, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { capsuleLabel(title, symbol) }.buttonStyle(HVPress())
    }

    private func capsuleLabel(_ title: String, _ symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .background(Capsule().fill(Color.white.opacity(0.2)))
            .overlay(Capsule().strokeBorder(Color.white.opacity(0.35), lineWidth: 0.5))
    }
}
