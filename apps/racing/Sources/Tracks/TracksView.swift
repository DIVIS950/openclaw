import MapKit
import RaceCore
import SwiftUI

struct TracksView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var kind: TrackKind?
    @State private var showMap = false
    @State private var creating = false

    private var filtered: [Track] {
        app.tracks.filter { t in
            (kind == nil || t.kind == kind)
                && (query.isEmpty || t.name.localizedCaseInsensitiveContains(query)
                    || t.city.localizedCaseInsensitiveContains(query) || t.country.localizedCaseInsensitiveContains(query))
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if showMap { mapView } else { list }
            }
            .background(Theme.background)
            .navigationTitle("Tracks")
            .searchable(text: $query, prompt: "Track, city or country")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showMap.toggle() } label: { Image(systemName: showMap ? "list.bullet" : "map") }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { creating = true } label: { Image(systemName: "plus") }
                }
            }
            .navigationDestination(for: String.self) { id in TrackDetailView(trackID: id) }
            .sheet(isPresented: $creating) { NewTrackSheet() }
        }
    }

    private var chips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack {
                chip("All", selected: kind == nil) { kind = nil }
                ForEach([TrackKind.circuit, .kart, .hillclimb, .custom], id: \.self) { k in
                    chip(k.rawValue.capitalized, selected: kind == k) { kind = k }
                }
            }
            .padding(.horizontal)
        }
    }

    private func chip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.subheadline.bold())
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(selected ? Theme.accent : Theme.surfaceHigh, in: Capsule())
                .foregroundStyle(.white)
        }
    }

    private var list: some View {
        List {
            Section { chips.listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
            ForEach(filtered) { t in
                NavigationLink(value: t.id) { TrackRow(track: t, best: app.bestLap(trackID: t.id)) }
                    .listRowBackground(Theme.surface)
            }
        }
        .scrollContentBackground(.hidden)
    }

    private var mapView: some View {
        Map {
            ForEach(filtered) { t in
                Annotation(t.name, coordinate: t.location.coordinate) {
                    NavigationLink(value: t.id) {
                        Image(systemName: t.kind == .kart ? "steeringwheel" : "flag.checkered")
                            .padding(7)
                            .background(Theme.accent, in: Circle())
                            .foregroundStyle(.white)
                    }
                }
            }
        }
        .mapStyle(.hybrid(elevation: .realistic))
    }
}

struct TrackRow: View {
    var track: Track
    var best: Lap?

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: track.kind == .kart ? "steeringwheel" : "flag.checkered")
                .frame(width: 36, height: 36)
                .background(Theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 10))
                .foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(track.name).font(.headline).foregroundStyle(.white)
                Text([track.city, track.country, track.length > 0 ? String(format: "%.2f km", track.length / 1000) : nil]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            if let best {
                Text(LapTimeFormat.string(best.time)).font(Theme.mono(15)).foregroundStyle(Theme.personalBest)
            }
        }
        .padding(.vertical, 4)
    }
}

struct TrackDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openURL) private var openURL
    let trackID: String
    @State private var editing = false

    var body: some View {
        if let t = app.track(id: trackID) {
            ScrollView {
                VStack(spacing: 14) {
                    TrackMap(track: t, lines: bestLine(t)).frame(height: 320).clipShape(RoundedRectangle(cornerRadius: 20))
                    HStack(spacing: 10) {
                        StatTile(title: "Length", value: t.length > 0 ? String(format: "%.3f km", t.length / 1000) : "?")
                        StatTile(title: "Sectors", value: "\(t.sectors.count + 1)")
                        StatTile(title: "Best", value: app.bestLap(trackID: t.id).map { LapTimeFormat.string($0.time) } ?? "--",
                                 color: Theme.personalBest)
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 8) {
                            Label(t.isTimingReady ? "Timing lines set" : "Start/finish not set", systemImage: t.isTimingReady ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                                .foregroundStyle(t.isTimingReady ? Theme.gain : Theme.warning)
                            Text(t.isTimingReady
                                 ? "Adjust the start/finish or add sector splits on the satellite map."
                                 : "Place the start/finish line on the satellite map, or just drive: Apex detects it after one lap.")
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                            Button("Edit timing lines") { editing = true }.buttonStyle(PrimaryButtonStyle(color: Theme.surfaceHigh))
                        }
                    }
                    if !t.notes.isEmpty {
                        Card { Text(t.notes).font(.callout).foregroundStyle(Theme.textSecondary) }
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("DIRECTIONS").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                            HStack {
                                Button { openURL(Directions.apple(t)) } label: { Label("Apple Maps", systemImage: "map.fill") }
                                    .buttonStyle(PrimaryButtonStyle(color: Theme.surfaceHigh))
                                Button { openURL(Directions.google(t)) } label: { Label("Google Maps", systemImage: "location.north.line.fill") }
                                    .buttonStyle(PrimaryButtonStyle(color: Theme.surfaceHigh))
                            }
                        }
                    }
                    let sessions = app.sessions(for: t.id)
                    if !sessions.isEmpty {
                        Card {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("YOUR SESSIONS").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                                ForEach(sessions) { s in
                                    NavigationLink { SessionDetailView(sessionID: s.id) } label: { SessionRow(session: s) }
                                }
                            }
                        }
                    }
                    if t.isUserDefined || t.startFinish != nil {
                        Button(t.isUserDefined ? "Delete track" : "Reset timing lines", role: .destructive) { app.resetTrack(t) }
                            .font(.footnote)
                    }
                }
                .padding()
            }
            .background(Theme.background)
            .navigationTitle(t.name)
            .navigationBarTitleDisplayMode(.inline)
            .fullScreenCover(isPresented: $editing) { GateEditorView(track: t) }
        }
    }

    private func bestLine(_ t: Track) -> [GeoPoint] {
        app.bestLap(trackID: t.id)?.samples.map(\.position) ?? []
    }
}

enum Directions {
    static func apple(_ t: Track) -> URL {
        URL(string: "http://maps.apple.com/?daddr=\(t.location.lat),\(t.location.lon)&dirflg=d")!
    }

    /// Google Maps app if installed, otherwise the universal web link (opens the app on Android/iOS too).
    static func google(_ t: Track) -> URL {
        let app = URL(string: "comgooglemaps://?daddr=\(t.location.lat),\(t.location.lon)&directionsmode=driving")!
        if UIApplication.shared.canOpenURL(app) { return app }
        return URL(string: "https://www.google.com/maps/dir/?api=1&destination=\(t.location.lat),\(t.location.lon)&travelmode=driving")!
    }
}

/// Satellite map with timing lines and an optional driven line.
struct TrackMap: View {
    var track: Track
    var lines: [GeoPoint] = []
    var ideal: [GeoPoint] = []
    var highlight: GeoPoint?

    var body: some View {
        Map(initialPosition: .camera(MapCamera(centerCoordinate: track.location.coordinate, distance: track.kind == .kart ? 900 : 3500))) {
            if !lines.isEmpty {
                MapPolyline(coordinates: lines.map(\.coordinate)).stroke(Theme.accent, lineWidth: 3)
            }
            if !ideal.isEmpty {
                MapPolyline(coordinates: ideal.map(\.coordinate)).stroke(Theme.personalBest, style: StrokeStyle(lineWidth: 3, dash: [6, 4]))
            }
            if let g = track.startFinish {
                MapPolyline(coordinates: g.polyline).stroke(.white, lineWidth: 5)
            }
            ForEach(Array(track.sectors.enumerated()), id: \.offset) { _, g in
                MapPolyline(coordinates: g.polyline).stroke(Theme.warning, lineWidth: 4)
            }
            if let h = highlight {
                Annotation("", coordinate: h.coordinate) {
                    Circle().fill(Theme.accent).frame(width: 14, height: 14).overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
        }
        .mapStyle(.imagery(elevation: .realistic))
    }
}
