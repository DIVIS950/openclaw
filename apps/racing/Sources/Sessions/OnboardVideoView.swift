import AVKit
import MapKit
import RaceCore
import SwiftUI

/// Onboard video with a synced data overlay (speed, lap time, live delta, G, track position).
/// Nudge buttons let the driver fine-tune sync by eye; the value is saved with the session.
struct OnboardVideoView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let session: Session
    let reference: ReferenceLap?

    @State private var player: AVPlayer?
    @State private var time: Double = 0
    @State private var offset: Double = 0
    @State private var observer: Any?

    private var sessionTime: Double { time + offset }
    private var sample: TelemetrySample? { session.sample(at: sessionTime) }
    private var lap: Lap? { session.lap(at: sessionTime) }

    /// Delta at the current frame vs the analysis reference.
    private var delta: Double? {
        guard let ref = reference, let lap, let s = sample else { return nil }
        let engine = DeltaEngine()
        engine.setReference(ref.lap, projection: ref.projection)
        // Global search is fine here (one lookup per UI tick).
        return engine.update(sample: s, lapElapsed: sessionTime - lap.startTime)?.delta
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player) { overlay }
                    .ignoresSafeArea()
            } else {
                ContentUnavailableView("Video missing", systemImage: "video.slash")
            }
        }
        .overlay(alignment: .topLeading) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.headline).padding(10).background(.ultraThinMaterial, in: Circle())
            }
            .padding()
        }
        .overlay(alignment: .topTrailing) { syncControls.padding() }
        .onAppear(perform: setup)
        .onDisappear(perform: teardown)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var overlay: some View {
        if let s = sample {
            VStack {
                Spacer()
                HStack(alignment: .bottom, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(s.speed.kmh).font(Theme.mono(48, weight: .heavy))
                        Text("KM/H").font(.caption2.bold()).foregroundStyle(.white.opacity(0.7))
                    }
                    GMeter(longG: s.longG, latG: s.latG).frame(width: 70, height: 70)
                    Spacer()
                    if let lap {
                        VStack(alignment: .trailing, spacing: 2) {
                            Text("LAP \(lap.number)").font(.caption.bold()).foregroundStyle(.white.opacity(0.7))
                            Text(LapTimeFormat.string(sessionTime - lap.startTime, decimals: 2)).font(Theme.mono(30))
                            if let d = delta {
                                Text(LapTimeFormat.delta(d)).font(Theme.mono(26, weight: .heavy)).foregroundStyle(Theme.deltaColor(d))
                            }
                        }
                    }
                    miniMap(s).frame(width: 130, height: 110)
                }
                .padding(14)
                .background(LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom))
            }
            .foregroundStyle(.white)
            .allowsHitTesting(false)
        }
    }

    private func miniMap(_ s: TelemetrySample) -> some View {
        Canvas { ctx, size in
            let pts = (lap ?? session.bestLap)?.samples.map(\.position) ?? []
            guard pts.count > 2 else { return }
            let lats = pts.map(\.lat), lons = pts.map(\.lon)
            let minLat = lats.min()!, maxLat = lats.max()!, minLon = lons.min()!, maxLon = lons.max()!
            let kx = cos(Geo.deg2rad((minLat + maxLat) / 2))
            let w = max((maxLon - minLon) * kx, 1e-9), h = max(maxLat - minLat, 1e-9)
            let scale = min(size.width / w, size.height / h) * 0.9
            func pt(_ p: GeoPoint) -> CGPoint {
                CGPoint(x: size.width / 2 + ((p.lon - (minLon + maxLon) / 2) * kx) * scale,
                        y: size.height / 2 - (p.lat - (minLat + maxLat) / 2) * scale)
            }
            var path = Path()
            path.move(to: pt(pts[0]))
            for p in pts.dropFirst() { path.addLine(to: pt(p)) }
            ctx.stroke(path, with: .color(.white.opacity(0.8)), lineWidth: 2)
            let c = pt(s.position)
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - 5, y: c.y - 5, width: 10, height: 10)), with: .color(Theme.accent))
        }
    }

    private var syncControls: some View {
        HStack(spacing: 6) {
            Button { nudge(-0.1) } label: { Image(systemName: "backward.frame") }
            Text(String(format: "sync %+.2fs", offset - (session.video?.sync.offset ?? 0)))
                .font(Theme.mono(12))
            Button { nudge(0.1) } label: { Image(systemName: "forward.frame") }
        }
        .padding(8)
        .background(.ultraThinMaterial, in: Capsule())
    }

    private func nudge(_ d: Double) {
        offset += d
        guard var s = app.sessions.first(where: { $0.id == session.id }), var v = s.video else { return }
        v.sync = VideoSync.Result(offset: offset, confidence: v.sync.confidence, method: .manual)
        s.video = v
        app.save(s)
    }

    private func setup() {
        guard let v = session.video else { return }
        offset = v.sync.offset
        let p = AVPlayer(url: app.videosDir.appendingPathComponent(v.fileName))
        // ~30 Hz overlay refresh
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(value: 1, timescale: 30), queue: .main) { t in
            time = t.seconds
        }
        player = p
        // Start at the first flying lap.
        if let first = session.laps.first {
            p.seek(to: CMTime(seconds: max(0, first.startTime - offset - 3), preferredTimescale: 600))
        }
        p.play()
    }

    private func teardown() {
        if let o = observer { player?.removeTimeObserver(o) }
        player?.pause()
    }
}
