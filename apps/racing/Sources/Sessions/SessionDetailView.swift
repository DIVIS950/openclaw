import Charts
import PhotosUI
import RaceCore
import SwiftUI

/// Everything about one session: laps, analysis vs a reference, ideal line, onboard video, AI debrief.
struct SessionDetailView: View {
    @Environment(AppModel.self) private var app
    let sessionID: UUID

    @State private var selectedLapID: UUID?
    @State private var referenceMode: ReferenceMode = .sessionBest
    @State private var analysis: Analysis?
    @State private var videoItem: PhotosPickerItem?
    @State private var videoBusy: String?
    @State private var videoError: String?
    @State private var showVideo = false
    @State private var showDebrief = false

    enum ReferenceMode: String, CaseIterable, Identifiable {
        case sessionBest = "Session best", allTimeBest = "All-time best"
        var id: String { rawValue }
    }

    struct Analysis {
        var reference: ReferenceLap
        var lap: Lap
        var trace: [AlignedPoint]
        var refTrace: [AlignedPoint]
        var corners: [CornerComparison]
        var ideal: (path: [GeoPoint], time: Double, sources: [Int])
    }

    private var session: Session? { app.sessions.first { $0.id == sessionID } }

    var body: some View {
        if let s = session {
            ScrollView {
                VStack(spacing: 14) {
                    summary(s)
                    videoCard(s)
                    lapsCard(s)
                    if let a = analysis {
                        mapCard(s, a)
                        chartsCard(a)
                        cornersCard(a)
                    }
                    Button { showDebrief = true } label: { Label("AI debrief: where did I lose time?", systemImage: "sparkles") }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(analysis == nil)
                    exportRow(s)
                }
                .padding()
            }
            .background(Theme.background)
            .navigationTitle(s.trackName)
            .navigationBarTitleDisplayMode(.inline)
            .task(id: "\(selectedLapID?.uuidString ?? "")\(referenceMode.rawValue)\(s.laps.count)") { analyze(s) }
            .onChange(of: videoItem) { _, item in if let item { Task { await importVideo(item, into: s) } } }
            .fullScreenCover(isPresented: $showVideo) { OnboardVideoView(session: s, reference: analysis?.reference) }
            .sheet(isPresented: $showDebrief) {
                if let a = analysis, let t = app.track(id: s.trackID) {
                    DebriefSheet(track: t, session: s, analysis: a)
                }
            }
        }
    }

    // MARK: Analysis

    private func analyze(_ s: Session) {
        guard let track = app.track(id: s.trackID), !s.laps.isEmpty else { analysis = nil; return }
        let lap = s.laps.first { $0.id == selectedLapID } ?? s.bestLap ?? s.laps[0]
        let refLap: Lap? = switch referenceMode {
        case .sessionBest: s.bestLap
        case .allTimeBest: app.bestLap(trackID: s.trackID) ?? s.bestLap
        }
        guard let refLap else { return }
        let ref = ReferenceLap(lap: refLap, projection: track.projection)
        analysis = Analysis(
            reference: ref,
            lap: lap,
            trace: thin(LapAnalysis.align(lap, to: ref)),
            refTrace: thin(LapAnalysis.align(refLap, to: ref)),
            corners: LapAnalysis.compare(lap, reference: ref),
            ideal: LapAnalysis.idealLine(laps: s.laps, reference: ref)
        )
    }

    /// Keep chart point counts reasonable (one point per ~4 m).
    private func thin(_ pts: [AlignedPoint]) -> [AlignedPoint] {
        var out: [AlignedPoint] = []
        for p in pts where out.last.map({ p.distance - $0.distance >= 4 }) ?? true { out.append(p) }
        return out
    }

    // MARK: Cards

    private func summary(_ s: Session) -> some View {
        let valid = s.laps.filter(\.isValid)
        let top = s.samples.map(\.speed).max() ?? 0
        return VStack(spacing: 10) {
            HStack(spacing: 10) {
                StatTile(title: "Best", value: s.bestLap.map { LapTimeFormat.string($0.time) } ?? "--", color: Theme.personalBest, size: 26)
                StatTile(title: "Ideal", value: s.theoreticalBest.map { LapTimeFormat.string($0) } ?? "--", color: Theme.gain, size: 26)
            }
            HStack(spacing: 10) {
                StatTile(title: "Laps", value: "\(valid.count)")
                StatTile(title: "Top speed", value: "\(top.kmh) km/h")
                StatTile(title: "Date", value: s.startDate.formatted(date: .numeric, time: .omitted), size: 16)
            }
        }
    }

    private func lapsCard(_ s: Session) -> some View {
        let best = s.bestLap
        let bestSectors = LapStats.bestSectors(s.laps)
        return Card {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("LAPS").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Picker("Reference", selection: $referenceMode) {
                        ForEach(ReferenceMode.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.menu)
                }
                ForEach(s.laps) { lap in
                    let selected = lap.id == (analysis?.lap.id)
                    Button { selectedLapID = lap.id } label: {
                        HStack {
                            Text("L\(lap.number)").font(Theme.mono(14)).foregroundStyle(Theme.textSecondary).frame(width: 36, alignment: .leading)
                            Text(LapTimeFormat.string(lap.time))
                                .font(Theme.mono(18))
                                .foregroundStyle(lap.id == best?.id ? Theme.personalBest : .white)
                            Spacer()
                            ForEach(Array(lap.sectorTimes.enumerated()), id: \.offset) { i, st in
                                Text(String(format: "%.2f", st))
                                    .font(Theme.mono(12))
                                    .foregroundStyle(i < bestSectors.count && abs(st - bestSectors[i]) < 0.0005 ? Theme.personalBest : Theme.textSecondary)
                            }
                            if let b = best, lap.id != b.id {
                                Text(LapTimeFormat.delta(lap.time - b.time)).font(Theme.mono(12)).foregroundStyle(Theme.loss)
                            }
                        }
                        .padding(8)
                        .background(selected ? Theme.accent.opacity(0.18) : .clear, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func mapCard(_ s: Session, _ a: Analysis) -> some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                if let t = app.track(id: s.trackID) {
                    TrackMap(track: t, lines: a.lap.samples.map(\.position), ideal: a.ideal.path)
                        .frame(height: 300)
                }
                HStack(spacing: 14) {
                    Label("L\(a.lap.number)", systemImage: "line.diagonal").foregroundStyle(Theme.accent)
                    Label("Ideal line \(LapTimeFormat.string(a.ideal.time))", systemImage: "line.diagonal").foregroundStyle(Theme.personalBest)
                }
                .font(.caption.bold())
                .padding(12)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private func chartsCard(_ a: Analysis) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("SPEED  ·  L\(a.lap.number) vs reference L\(a.reference.lap.number)").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                Chart {
                    ForEach(Array(a.refTrace.enumerated()), id: \.offset) { _, p in
                        LineMark(x: .value("m", p.distance), y: .value("km/h", p.speed * 3.6), series: .value("lap", "Reference"))
                            .foregroundStyle(Theme.personalBest)
                    }
                    ForEach(Array(a.trace.enumerated()), id: \.offset) { _, p in
                        LineMark(x: .value("m", p.distance), y: .value("km/h", p.speed * 3.6), series: .value("lap", "Lap"))
                            .foregroundStyle(Theme.accent)
                    }
                    ForEach(a.corners) { c in
                        RuleMark(x: .value("apex", c.corner.apex))
                            .foregroundStyle(Theme.stroke)
                            .annotation(position: .top) { Text("T\(c.corner.number)").font(.system(size: 9, weight: .bold)).foregroundStyle(Theme.textSecondary) }
                    }
                }
                .chartXAxisLabel("distance (m)")
                .frame(height: 180)

                Text("DELTA (s)").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                Chart {
                    ForEach(Array(a.trace.enumerated()), id: \.offset) { _, p in
                        AreaMark(x: .value("m", p.distance), y: .value("s", p.delta))
                            .foregroundStyle(LinearGradient(colors: [Theme.loss.opacity(0.45), Theme.gain.opacity(0.45)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("m", p.distance), y: .value("s", p.delta)).foregroundStyle(.white)
                    }
                    RuleMark(y: .value("zero", 0)).foregroundStyle(Theme.stroke)
                }
                .frame(height: 140)
            }
        }
    }

    private func cornersCard(_ a: Analysis) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Text("CORNERS  ·  time vs reference").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                ForEach(a.corners.sorted { $0.timeLoss > $1.timeLoss }) { c in
                    HStack(spacing: 10) {
                        Text("T\(c.corner.number)").font(Theme.mono(15)).frame(width: 34, alignment: .leading)
                        Image(systemName: c.corner.direction == .left ? "arrow.turn.up.left" : "arrow.turn.up.right")
                            .foregroundStyle(Theme.textSecondary)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("min \(c.lap.minSpeed.kmh) (\(signed((c.lap.minSpeed - c.reference.minSpeed) * 3.6))) · exit \(c.lap.exitSpeed.kmh) (\(signed((c.lap.exitSpeed - c.reference.exitSpeed) * 3.6))) km/h")
                            Text("brake point \(signed(c.lap.brakePoint - c.reference.brakePoint)) m · peak \(String(format: "%.2f", c.lap.peakBrakeG))g")
                        }
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                        Spacer()
                        Text(LapTimeFormat.delta(c.timeLoss)).font(Theme.mono(15)).foregroundStyle(Theme.deltaColor(c.timeLoss))
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func signed(_ v: Double) -> String { String(format: "%+.0f", v) }

    private func videoCard(_ s: Session) -> some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                Text("ONBOARD VIDEO").font(.caption.bold()).foregroundStyle(Theme.textSecondary)
                if let v = s.video {
                    Button { showVideo = true } label: { Label("Watch onboard with data", systemImage: "play.rectangle.fill") }
                        .buttonStyle(PrimaryButtonStyle())
                    Text("Synced by \(v.sync.method.rawValue) · offset \(String(format: "%.2f", v.sync.offset)) s · confidence \(Int(v.sync.confidence * 100))%")
                        .font(.caption).foregroundStyle(Theme.textSecondary)
                } else if let busy = videoBusy {
                    HStack { ProgressView(); Text(busy).font(.footnote) }
                    if let p = app.goPro.downloadProgress { ProgressView(value: p) }
                } else {
                    HStack {
                        Button { Task { await downloadFromGoPro(s) } } label: { Label("From GoPro", systemImage: "camera.fill") }
                            .buttonStyle(PrimaryButtonStyle(color: Theme.surfaceHigh))
                            .disabled(!app.goPro.isReady)
                        PhotosPicker(selection: $videoItem, matching: .videos) {
                            Label("From Photos", systemImage: "photo.on.rectangle")
                                .font(.system(size: 17, weight: .bold)).frame(maxWidth: .infinity).padding(.vertical, 16)
                                .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 14)).foregroundStyle(.white)
                        }
                    }
                }
                if let e = videoError { Text(e).font(.caption).foregroundStyle(Theme.loss) }
            }
        }
    }

    private func exportRow(_ s: Session) -> some View {
        HStack {
            ShareLink(item: ExportFile(name: "\(s.trackName)-\(s.id.uuidString.prefix(6)).csv", text: SessionExport.csv(s)),
                      preview: SharePreview("Telemetry CSV")) { Label("CSV", systemImage: "tablecells") }
            Spacer()
            ShareLink(item: ExportFile(name: "\(s.trackName)-\(s.id.uuidString.prefix(6)).gpx", text: SessionExport.gpx(s)),
                      preview: SharePreview("GPX track")) { Label("GPX", systemImage: "point.topleft.down.curvedto.point.bottomright.up") }
        }
        .font(.footnote.bold())
        .padding(.horizontal)
    }

    // MARK: Video

    private func downloadFromGoPro(_ s: Session) async {
        videoError = nil
        videoBusy = "Downloading from GoPro Wi-Fi…"
        defer { videoBusy = nil }
        do {
            let url = try await app.goPro.downloadLatestVideo(to: app.videosDir)
            await attach(url, to: s, shutter: app.goPro.recordingStartedAt)
        } catch {
            videoError = error.localizedDescription
        }
    }

    private func importVideo(_ item: PhotosPickerItem, into s: Session) async {
        videoError = nil
        videoBusy = "Importing video…"
        defer { videoBusy = nil; videoItem = nil }
        do {
            guard let movie = try await item.loadTransferable(type: MovieFile.self) else { return }
            let dest = app.videosDir.appendingPathComponent("\(UUID().uuidString).\(movie.url.pathExtension)")
            try FileManager.default.moveItem(at: movie.url, to: dest)
            await attach(dest, to: s, shutter: nil)
        } catch {
            videoError = error.localizedDescription
        }
    }

    private func attach(_ url: URL, to s: Session, shutter: Date?) async {
        videoBusy = "Syncing video with telemetry…"
        let sync = await VideoImporter.sync(session: s, videoURL: url, shutterStart: shutter)
            ?? VideoSync.Result(offset: 0, confidence: 0, method: .manual)
        let duration = await VideoImporter.duration(url: url)
        var updated = app.sessions.first { $0.id == s.id } ?? s
        updated.video = VideoLink(fileName: url.lastPathComponent, sync: sync, duration: duration)
        app.save(updated)
    }
}

/// Transferable wrapper that copies a picked movie into our sandbox.
struct MovieFile: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { SentTransferredFile($0.url) } importing: { received in
            let copy = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(received.file.pathExtension)")
            try FileManager.default.copyItem(at: received.file, to: copy)
            return MovieFile(url: copy)
        }
    }
}

/// Text export written to a temp file for the share sheet.
struct ExportFile: Transferable {
    let name: String
    let text: String
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .commaSeparatedText) { f in
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(f.name)
            try f.text.write(to: url, atomically: true, encoding: .utf8)
            return SentTransferredFile(url)
        }
    }
}
