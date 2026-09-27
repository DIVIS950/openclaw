import CoreLocation
import RaceCore
import SwiftUI

/// Pre-session setup (track, vehicle, reference, devices) and the full-screen live dashboard.
struct LiveTab: View {
    @Environment(AppModel.self) private var app
    @State private var trackID: String?
    @State private var detecting = false
    @State private var live: LiveSessionController?
    @State private var finished: Session?
    @State private var showBriefing = false
    @State private var referenceChoice: ReferenceChoice = .allTimeBest
    @State private var detectedDistance: Double?

    enum ReferenceChoice: String, CaseIterable, Identifiable {
        case allTimeBest = "All-time best"
        case none = "First lap sets it"
        var id: String { rawValue }
    }

    private var track: Track? { trackID.flatMap(app.track(id:)) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    trackCard
                    vehicleCard
                    devicesCard
                    if let t = track { referenceCard(t) }
                    Button {
                        showBriefing = true
                    } label: {
                        Label("AI briefing before I go", systemImage: "waveform.and.mic")
                    }
                    .buttonStyle(PrimaryButtonStyle(color: Theme.surfaceHigh))
                    .disabled(track == nil)

                    Button(action: start) {
                        Label("Start session", systemImage: "flag.checkered")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(track == nil)
                }
                .padding()
            }
            .background(Theme.background)
            .navigationTitle("Drive")
            .task { if trackID == nil { await detectTrack() } }
            .navigationDestination(item: $finished) { s in SessionDetailView(sessionID: s.id) }
            .sheet(isPresented: $showBriefing) {
                if let t = track { BriefingSheet(track: t) }
            }
        }
        .fullScreenCover(item: Binding(get: { live.map { LiveBox(controller: $0) } }, set: { if $0 == nil { live = nil } })) { box in
            LiveDashboardView(live: box.controller, goPro: app.goPro, deltaRange: app.settings.deltaBarRange) {
                stop(box.controller)
            }
        }
    }

    // MARK: Cards

    private var trackCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("TRACK").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    if detecting { ProgressView().controlSize(.small) }
                    Button("Detect") { Task { await detectTrack() } }.font(.caption.bold())
                }
                Picker("Track", selection: $trackID) {
                    Text("Select a track").tag(String?.none)
                    ForEach(app.tracks) { t in Text("\(t.name) · \(t.country)").tag(Optional(t.id)) }
                }
                .pickerStyle(.navigationLink)
                if let t = track {
                    HStack {
                        PillLabel(text: t.kind.rawValue.capitalized, color: Theme.accent)
                        if t.length > 0 { PillLabel(text: String(format: "%.2f km", t.length / 1000), color: Theme.textSecondary) }
                        if let d = detectedDistance { PillLabel(text: "Detected \(Int(d)) m away", color: Theme.gain, systemImage: "location.fill") }
                    }
                    if !t.isTimingReady {
                        Label("No start/finish line yet. Drive one lap and Apex finds it, or set it on the map in Tracks.",
                              systemImage: "info.circle")
                            .font(.footnote).foregroundStyle(Theme.warning)
                    }
                }
            }
        }
    }

    private var vehicleCard: some View {
        @Bindable var app = app
        return Card {
            VStack(alignment: .leading, spacing: 8) {
                Text("VEHICLE").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                Picker("Vehicle", selection: $app.settings.selectedVehicleID) {
                    ForEach(app.vehicles) { v in Text("\(v.name) (\(v.vehicleClass.displayName))").tag(Optional(v.id)) }
                }
                .pickerStyle(.menu)
            }
        }
    }

    private var devicesCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("DEVICES").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                HStack {
                    Image(systemName: "location.fill").foregroundStyle(Theme.accent)
                    Text(app.settings.gpsSource.title)
                    Spacer()
                }
                HStack {
                    Image(systemName: "camera.fill").foregroundStyle(app.goPro.isReady ? Theme.gain : Theme.textSecondary)
                    Text(goProText)
                    Spacer()
                    if !app.goPro.isReady { Button("Connect") { app.goPro.connect() }.font(.caption.bold()) }
                }
            }
        }
    }

    private var goProText: String {
        switch app.goPro.state {
        case .off: "GoPro not connected"
        case .scanning: "Searching for GoPro…"
        case .connecting: "Connecting…"
        case let .ready(name): app.settings.goProAutoRecord ? "\(name): auto-record on" : name
        case let .failed(msg): msg
        }
    }

    private func referenceCard(_ t: Track) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text("DELTA REFERENCE").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                Picker("Reference", selection: $referenceChoice) {
                    ForEach(ReferenceChoice.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                if referenceChoice == .allTimeBest {
                    if let best = app.bestLap(trackID: t.id, vehicleClass: app.selectedVehicle?.vehicleClass) {
                        Text("Chasing \(LapTimeFormat.string(best.time)). Beat it and the delta switches to your new best.")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    } else {
                        Text("No laps here yet. Your first flying lap becomes the reference.")
                            .font(.footnote).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
    }

    // MARK: Actions

    private func detectTrack() async {
        detecting = true
        defer { detecting = false }
        CLLocationManager().requestWhenInUseAuthorization()
        do {
            for try await update in CLLocationUpdate.liveUpdates() {
                guard let loc = update.location, loc.horizontalAccuracy < 200 else { continue }
                let p = GeoPoint(loc.coordinate)
                if let t = TrackLocator.nearest(to: p, in: app.tracks) {
                    trackID = t.id
                    detectedDistance = Geo.distance(p, t.location)
                }
                break
            }
        } catch {}
    }

    private func start() {
        guard let t = track else { return }
        let ref = referenceChoice == .allTimeBest
            ? app.bestLap(trackID: t.id, vehicleClass: app.selectedVehicle?.vehicleClass) : nil
        let c = LiveSessionController(
            track: t, vehicle: app.selectedVehicle, reference: ref,
            settings: app.settings, goPro: app.goPro, speech: app.coach.speech
        )
        live = c
        c.start()
    }

    private func stop(_ c: LiveSessionController) {
        let session = c.stop()
        // Persist a start/finish line discovered on an unsurveyed track.
        if var t = track, t.startFinish == nil, let g = c.inferredGate {
            t.startFinish = g
            app.saveTrack(t)
        }
        live = nil
        if !session.samples.isEmpty {
            app.save(session)
            finished = session
        }
    }
}

/// Identifiable wrapper so the controller can drive `fullScreenCover(item:)`.
private struct LiveBox: Identifiable {
    let controller: LiveSessionController
    var id: ObjectIdentifier { ObjectIdentifier(controller) }
}
