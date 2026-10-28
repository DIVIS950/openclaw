import PhotosUI
import SwiftUI

@MainActor
struct RoomsView: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        ScrollView {
            if store.home.rooms.isEmpty {
                EmptyState(icon: "square.split.2x2", title: "No rooms yet", message: "Rooms appear once the app is connected.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 14)], spacing: 14) {
                    ForEach(store.home.rooms) { room in
                        NavigationLink(value: room.id) { RoomCard(room: room) }
                            .buttonStyle(PressableStyle())
                    }
                }
                .padding()
            }
        }
        .screenBackground()
        .navigationTitle("Rooms")
        .navigationDestination(for: String.self) { RoomDetailView(roomId: $0) }
    }
}

@MainActor
struct RoomDetailView: View {
    @Environment(HomeStore.self) private var store
    @Environment(RoomPhotos.self) private var photos
    @Environment(\.horizontalSizeClass) private var sizeClass
    let roomId: String
    @State private var photoItem: PhotosPickerItem?

    var body: some View {
        let home = store.home
        let room = home.room(roomId) ?? Room(id: roomId, name: "Room")
        let lights = home.lights(in: roomId)
        let shades = home.shades(in: roomId)
        let scenes = home.scenes(in: roomId)
        let media = home.media(in: roomId)
        let locks = home.locks(in: roomId)

        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ZStack(alignment: .bottomLeading) {
                    RoomBackground(room: room)
                    LinearGradient(colors: [.clear, .black.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(room.name).font(.system(size: 34, weight: .bold, design: .rounded))
                        let on = lights.filter(\.isOn).count
                        Text(on == 0 ? "Lights off" : "\(on) of \(lights.count) lights on")
                            .font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.8))
                    }
                    .padding(20)
                }
                .frame(height: sizeClass == .regular ? 240 : 190)
                .clipShape(RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))

                if !lights.isEmpty {
                    HStack(spacing: 12) {
                        allButton("All On", icon: "lightbulb.max.fill", level: 1, lights: lights)
                        allButton("All Off", icon: "lightbulb.slash", level: 0, lights: lights)
                    }
                }

                if !scenes.isEmpty {
                    SectionHeader(title: "Scenes")
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12)], spacing: 12) {
                        ForEach(scenes) { SceneTile(scene: $0) }
                    }
                }

                // On iPad, lights and shades sit side by side like a control panel.
                let columns = [GridItem(.adaptive(minimum: 340), spacing: 20, alignment: .top)]
                LazyVGrid(columns: columns, alignment: .leading, spacing: 24) {
                    if !lights.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Lights")
                            ForEach(lights) { LightRow(light: $0) }
                        }
                    }
                    if !shades.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Shades")
                            ForEach(shades) { ShadeRow(shade: $0).card(padding: 12) }
                        }
                    }
                    if !media.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Media")
                            ForEach(media) { MediaZoneCard(zone: $0) }
                        }
                    }
                    if !locks.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: "Doors")
                            ForEach(locks) { LockRow(lock: $0) }
                        }
                    }
                }
            }
            .padding(sizeClass == .regular ? 28 : 16)
        }
        .screenBackground()
        .navigationTitle(room.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("Choose Room Photo", systemImage: "photo")
                    }
                    if photos.image(for: roomId) != nil {
                        Button("Remove Photo", systemImage: "trash", role: .destructive) {
                            photos.removeImage(for: roomId)
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
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

    private func allButton(_ title: String, icon: String, level: Double, lights: [Light]) -> some View {
        Button {
            for light in lights { store.perform(.setLight(id: light.id, level: level)) }
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(PressableStyle())
        .foregroundStyle(level > 0 ? Theme.light : .white)
    }
}

/// Every light in the house, grouped by room (iPad sidebar).
@MainActor
struct LightsView: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        DeviceListByRoom(title: "Lights", empty: "No lights found.", ids: home.lights.map { home.knownRoomId($0.roomId) }) { roomId in
            ForEach(home.lights.filter { home.knownRoomId($0.roomId) == roomId }) { LightRow(light: $0) }
        }
    }
}

/// Every shade in the house, grouped by room (iPad sidebar).
@MainActor
struct ShadesView: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        let home = store.home
        DeviceListByRoom(title: "Shades", empty: "No shades found.", ids: home.shades.map { home.knownRoomId($0.roomId) }) { roomId in
            ForEach(home.shades.filter { home.knownRoomId($0.roomId) == roomId }) { ShadeRow(shade: $0) }
        }
    }
}

@MainActor
private struct DeviceListByRoom<Rows: View>: View {
    @Environment(HomeStore.self) private var store
    let title: String
    let empty: String
    /// Room id of every device, in order; nil = no (known) room.
    let ids: [String?]
    @ViewBuilder let rows: (String?) -> Rows

    var body: some View {
        // Keep the processor's room order, then devices without a room.
        let present = Set(ids.map { $0 ?? "" })
        let roomOrder: [String?] = store.home.rooms.map(\.id).filter { present.contains($0) } + (present.contains("") ? [nil] : [])
        ScrollView {
            if ids.isEmpty {
                EmptyState(icon: "questionmark.circle", title: title, message: empty)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: 20, alignment: .top)], alignment: .leading, spacing: 20) {
                    ForEach(roomOrder, id: \.self) { roomId in
                        VStack(alignment: .leading, spacing: 12) {
                            SectionHeader(title: store.home.room(roomId)?.name ?? "Other")
                            rows(roomId)
                        }
                        .card()
                    }
                }
                .padding()
            }
        }
        .screenBackground()
        .navigationTitle(title)
    }
}
