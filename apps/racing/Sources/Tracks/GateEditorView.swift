import MapKit
import RaceCore
import SwiftUI

/// Place start/finish, sector splits and (for hill climbs) a separate finish on the satellite map.
/// Tap = place the line; direction auto-snaps to your recorded driving direction when available.
struct GateEditorView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var track: Track
    @State private var mode: Mode = .startFinish
    @State private var selectedSector: Int?
    @State private var camera: MapCameraPosition

    enum Mode: String, CaseIterable, Identifiable {
        case startFinish = "Start/Finish", sector = "Add sector", finish = "Finish (P2P)"
        var id: String { rawValue }
    }

    init(track: Track) {
        _track = State(initialValue: track)
        _camera = State(initialValue: .camera(MapCamera(
            centerCoordinate: (track.startFinish?.center ?? track.location).coordinate,
            distance: track.kind == .kart ? 500 : 1500
        )))
    }

    /// Recorded samples at this track used for heading snapping and as a guide trace.
    private var guide: [TelemetrySample] {
        app.sessions(for: track.id).first?.samples ?? []
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                MapReader { proxy in
                    Map(position: $camera) {
                        if !guide.isEmpty {
                            MapPolyline(coordinates: guide.map(\.position.coordinate)).stroke(Theme.accent.opacity(0.7), lineWidth: 2)
                        }
                        if let g = track.startFinish {
                            MapPolyline(coordinates: g.polyline).stroke(.white, lineWidth: 5)
                            arrow(g, color: .white)
                        }
                        if let g = track.finish {
                            MapPolyline(coordinates: g.polyline).stroke(Theme.loss, lineWidth: 5)
                        }
                        ForEach(Array(track.sectors.enumerated()), id: \.offset) { i, g in
                            MapPolyline(coordinates: g.polyline).stroke(selectedSector == i ? Theme.accent : Theme.warning, lineWidth: 4)
                            Annotation("", coordinate: g.center.coordinate) {
                                Button { selectedSector = i } label: {
                                    Text("S\(i + 2)").font(.caption2.bold()).padding(4).background(Theme.warning, in: Capsule())
                                }
                            }
                        }
                    }
                    .mapStyle(.imagery)
                    .onTapGesture { pt in
                        guard let c = proxy.convert(pt, from: .local) else { return }
                        place(at: GeoPoint(c))
                    }
                }
                .ignoresSafeArea(edges: .bottom)

                controls
            }
            .navigationTitle("Timing lines")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { app.saveTrack(track); dismiss() }.bold()
                }
            }
        }
    }

    @MapContentBuilder
    private func arrow(_ g: Gate, color: Color) -> some MapContent {
        let tip = Geo.destination(g.center, bearing: g.heading, distance: 25)
        MapPolyline(coordinates: [g.center.coordinate, tip.coordinate]).stroke(color, style: StrokeStyle(lineWidth: 3, dash: [4, 3]))
    }

    private var controls: some View {
        VStack(spacing: 10) {
            Picker("Mode", selection: $mode) {
                ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            Text(hint).font(.footnote).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
            if let binding = activeGate {
                HStack {
                    Text("Direction").font(.caption.bold())
                    Slider(value: binding.heading, in: 0...359)
                    Button { binding.wrappedValue.heading = Geo.normalizeDegrees(binding.wrappedValue.heading + 180) } label: {
                        Image(systemName: "arrow.left.arrow.right")
                    }
                }
                HStack {
                    Text("Width \(Int(binding.wrappedValue.width)) m").font(.caption.bold())
                    Slider(value: binding.width, in: 8...80)
                }
            }
            if let i = selectedSector {
                Button("Delete sector S\(i + 2)", role: .destructive) {
                    track.sectors.remove(at: i)
                    selectedSector = nil
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding()
    }

    private var hint: String {
        switch mode {
        case .startFinish: "Tap the start/finish line on the track. The arrow shows the driving direction."
        case .sector: "Tap to add a sector split. Add them in lap order."
        case .finish: "Hill climbs / point-to-point only: tap the finish line."
        }
    }

    private var activeGate: Binding<Gate>? {
        if let i = selectedSector, i < track.sectors.count { return $track.sectors[i] }
        switch mode {
        case .startFinish: return track.startFinish == nil ? nil : Binding($track.startFinish)
        case .finish: return track.finish == nil ? nil : Binding($track.finish)
        case .sector: return nil
        }
    }

    private func place(at p: GeoPoint) {
        // Snap direction to the nearest recorded sample within 40 m, else keep / guess.
        let nearest = guide.min { Geo.distance($0.position, p) < Geo.distance($1.position, p) }
        let heading: Double = {
            if let n = nearest, Geo.distance(n.position, p) < 40, !n.heading.isNaN { return n.heading }
            return track.startFinish?.heading ?? 0
        }()
        let width = track.kind == .kart ? 16.0 : 30.0
        let gate = Gate(center: p, heading: heading, width: width)
        selectedSector = nil
        switch mode {
        case .startFinish: track.startFinish = gate
        case .finish: track.finish = gate
        case .sector:
            track.sectors.append(gate)
            selectedSector = track.sectors.count - 1
        }
    }
}

struct NewTrackSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kind: TrackKind = .kart
    @State private var length = ""
    @State private var position: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var center: CLLocationCoordinate2D?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Track name", text: $name)
                Picker("Type", selection: $kind) {
                    ForEach(TrackKind.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                }
                TextField("Length in meters (optional)", text: $length).keyboardType(.numberPad)
                Section("Move the map so the pin is on the track") {
                    MapReader { _ in
                        Map(position: $position)
                            .mapStyle(.imagery)
                            .onMapCameraChange { ctx in center = ctx.region.center }
                            .overlay { Image(systemName: "mappin").font(.title).foregroundStyle(Theme.accent).offset(y: -12) }
                    }
                    .frame(height: 280)
                    .listRowInsets(EdgeInsets())
                }
            }
            .navigationTitle("New track")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        guard let c = center else { return }
                        app.saveTrack(Track(
                            id: "user-\(UUID().uuidString.prefix(8))", name: name, country: "", kind: kind,
                            length: Double(length) ?? 0, location: GeoPoint(c), isUserDefined: true
                        ))
                        dismiss()
                    }
                    .disabled(name.isEmpty || center == nil)
                }
            }
        }
    }
}
