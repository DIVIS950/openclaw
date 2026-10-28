import SwiftUI

struct HomeDashboardView: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.horizontalSizeClass) private var sizeClass
    var openSettings: (() -> Void)?

    private var home: HomeSnapshot { store.home }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                statusStrip

                if !home.homeScenes.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Scenes")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: sizeClass == .regular ? 170 : 140), spacing: 12)], spacing: 12) {
                            ForEach(home.homeScenes) { SceneTile(scene: $0) }
                        }
                    }
                }

                if !home.gates.isEmpty || !home.security.isEmpty {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 16)], spacing: 16) {
                        ForEach(home.gates) { GateCard(gate: $0, compact: true) }
                        ForEach(home.security) { SecurityPanelCard(panel: $0) }
                    }
                }

                if !home.rooms.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Rooms", trailing: "\(home.rooms.count)")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: sizeClass == .regular ? 240 : 160), spacing: 14)], spacing: 14) {
                            ForEach(home.rooms) { room in
                                NavigationLink(value: room.id) { RoomCard(room: room) }
                                    .buttonStyle(PressableStyle())
                            }
                        }
                    }
                }

                let playing = home.media.filter(\.isOn)
                if !playing.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionHeader(title: "Now Playing")
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: 16)], spacing: 16) {
                            ForEach(playing) { MediaZoneCard(zone: $0) }
                        }
                    }
                }
            }
            .padding(sizeClass == .regular ? 28 : 16)
        }
        .screenBackground()
        .navigationDestination(for: String.self) { RoomDetailView(roomId: $0) }
        // The big header replaces the nav bar on iPhone; iPad keeps it for the sidebar button.
        .toolbar(sizeClass == .regular ? .automatic : .hidden, for: .navigationBar)
    }

    private var header: some View {
        HStack(alignment: .top) {
            TimelineView(.everyMinute) { context in
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.date, format: .dateTime.weekday(.wide).month(.wide).day())
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    Text(greeting(for: context.date))
                        .font(.system(size: sizeClass == .regular ? 40 : 30, weight: .bold, design: .rounded))
                }
            }
            Spacer()
            ConnectionBadge()
            if let openSettings {
                Button(action: openSettings) {
                    Image(systemName: "gearshape.fill")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(.white)
                .accessibilityLabel("Settings")
            }
        }
    }

    private var statusStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                StatusChip(icon: "lightbulb.fill", text: home.lightsOnCount == 0 ? "All lights off" : "\(home.lightsOnCount) lights on", tint: Theme.light)
                ForEach(home.security) { panel in
                    StatusChip(icon: "shield.fill", text: panel.mode.title, tint: panel.mode == .alarm ? Theme.alert : Theme.secure)
                }
                if !home.locks.isEmpty {
                    StatusChip(icon: home.unlockedCount > 0 ? "lock.open.fill" : "lock.fill",
                               text: home.unlockedCount > 0 ? "\(home.unlockedCount) unlocked" : "Doors locked",
                               tint: home.unlockedCount > 0 ? Theme.alert : Theme.secure)
                }
                ForEach(home.gates) { gate in
                    StatusChip(icon: "door.garage.closed", text: "\(gate.name): \(gate.state.title)", tint: Theme.gate)
                }
                let playing = home.media.filter(\.isOn).count
                if playing > 0 {
                    StatusChip(icon: "music.note", text: "\(playing) playing", tint: Theme.media)
                }
            }
        }
        .scrollClipDisabled()
    }

    private func greeting(for date: Date) -> String {
        let hour = Calendar.current.component(.hour, from: date)
        let part = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
        return settings.homeName.isEmpty || settings.homeName == "Home" ? part : "\(part) · \(settings.homeName)"
    }
}

struct RoomCard: View {
    @Environment(HomeStore.self) private var store
    @Environment(RoomPhotos.self) private var photos
    let room: Room

    var body: some View {
        let lightsOn = store.home.lights(in: room.id).filter(\.isOn).count
        let playing = store.home.media(in: room.id).first { $0.isOn }
        ZStack(alignment: .bottomLeading) {
            RoomBackground(room: room)
            LinearGradient(colors: [.clear, .black.opacity(0.65)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 4) {
                Spacer()
                Text(room.name).font(.headline).foregroundStyle(.white).lineLimit(1)
                HStack(spacing: 10) {
                    if lightsOn > 0 {
                        Label("\(lightsOn)", systemImage: "lightbulb.fill").foregroundStyle(Theme.light)
                    }
                    if let playing {
                        Label(playing.currentSource?.name ?? "On", systemImage: "music.note").foregroundStyle(Theme.media).lineLimit(1)
                    }
                    if lightsOn == 0 && playing == nil {
                        Text("Off").foregroundStyle(.white.opacity(0.6))
                    }
                }
                .font(.caption.weight(.semibold))
            }
            .padding(14)
        }
        .frame(height: 150)
        .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .overlay(alignment: .topTrailing) {
            if photos.image(for: room.id) == nil {
                Image(systemName: Theme.roomSymbol(room.name))
                    .font(.title2)
                    .foregroundStyle(.white.opacity(0.85))
                    .padding(14)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                .strokeBorder(lightsOn > 0 ? Theme.light.opacity(0.35) : .white.opacity(0.07))
        )
    }
}

/// The room's photo if one was picked, otherwise its color gradient.
struct RoomBackground: View {
    @Environment(RoomPhotos.self) private var photos
    let room: Room

    var body: some View {
        if let image = photos.image(for: room.id) {
            Color.clear.overlay(Image(uiImage: image).resizable().scaledToFill())
        } else {
            Theme.roomGradient(room.name)
        }
    }
}

struct ConnectionBadge: View {
    @Environment(HomeStore.self) private var store

    private var appearance: (text: String, color: Color) {
        switch store.connection {
        case .connected: store.mode == .demo ? ("Demo", Theme.light) : ("Connected", Theme.secure)
        case .connecting: ("Connecting…", Theme.light)
        case .idle: ("Offline", Color.secondary)
        case .failed: ("Offline", Theme.alert)
        }
    }

    var body: some View {
        let look = appearance
        HStack(spacing: 6) {
            Circle().fill(look.color).frame(width: 8, height: 8)
            Text(look.text).font(.footnote.weight(.semibold))
        }
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.top, 6)
    }
}
