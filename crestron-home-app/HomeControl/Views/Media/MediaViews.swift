import SwiftUI

@MainActor
struct MediaZoneCard: View {
    @Environment(HomeStore.self) private var store
    let zone: MediaZone

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: zone.isOn ? "hifispeaker.2.fill" : "hifispeaker.2")
                    .font(.title2)
                    .foregroundStyle(zone.isOn ? Theme.media : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(zone.name).font(.headline)
                    Text(zone.isOn ? (zone.currentSource?.name ?? "On") : "Off")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Spacer()
                CircleButton(icon: "power", isOn: zone.isOn, tint: Theme.media, size: 46) {
                    store.perform(.mediaPower(zoneId: zone.id, on: !zone.isOn))
                }
            }

            if !zone.sources.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(zone.sources) { source in
                            let selected = zone.isOn && source.id == zone.currentSourceId
                            Button {
                                store.perform(.mediaSource(zoneId: zone.id, sourceId: source.id))
                            } label: {
                                Text(source.name)
                                    .font(.subheadline.weight(.semibold))
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 9)
                                    .foregroundStyle(selected ? .black : .white)
                                    .background(selected ? AnyShapeStyle(Theme.media.gradient) : AnyShapeStyle(.white.opacity(0.08)), in: Capsule())
                            }
                            .buttonStyle(PressableStyle())
                        }
                    }
                }
            }

            if zone.hasVolume {
                HStack(spacing: 10) {
                    CircleButton(icon: zone.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill",
                                 isOn: zone.isMuted, tint: Theme.alert, size: 46) {
                        store.perform(.mediaMute(zoneId: zone.id, muted: !zone.isMuted))
                    }
                    LevelSlider(value: zone.volume, tint: Theme.media, icon: "speaker.wave.3.fill", label: "Volume", height: 46) { level in
                        store.perform(.mediaVolume(zoneId: zone.id, level: level))
                    }
                }
                .disabled(!zone.isOn)
                .opacity(zone.isOn ? 1 : 0.5)
            }
        }
        .card()
    }
}

@MainActor
struct MediaView: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        ScrollView {
            if store.home.media.isEmpty {
                EmptyState(icon: "hifispeaker.2", title: "No media rooms", message: "Audio/video zones from your system show up here.")
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 340), spacing: 16)], spacing: 16) {
                    ForEach(store.home.media) { MediaZoneCard(zone: $0) }
                }
                .padding()
            }
        }
        .screenBackground()
        .navigationTitle("Media")
    }
}

@MainActor
struct EmptyState: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        ContentUnavailableView(title, systemImage: icon, description: Text(message))
            .padding(.top, 80)
    }
}
