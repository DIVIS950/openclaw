import MapKit
import RaceCore
import SwiftUI

/// In-car dashboard. Designed to be read in a glance: delta is the biggest element,
/// colour carries the meaning (green gaining / red losing / purple personal best).
struct LiveDashboardView: View {
    @Bindable var live: LiveSessionController
    var goPro: GoProService
    var deltaRange: Double
    var onStop: () -> Void

    @State private var stopHold = false

    var body: some View {
        GeometryReader { geo in
            let landscape = geo.size.width > geo.size.height
            ZStack {
                Theme.background.ignoresSafeArea()
                if landscape {
                    HStack(spacing: 16) {
                        VStack(spacing: 12) { deltaBlock(large: true); timesRow }
                            .frame(maxWidth: .infinity)
                        VStack(spacing: 12) { splits; speedAndG; miniMap.frame(maxHeight: .infinity) }
                            .frame(width: geo.size.width * 0.34)
                    }
                    .padding()
                } else {
                    VStack(spacing: 14) {
                        statusBar
                        deltaBlock(large: false)
                        timesRow
                        splits
                        speedAndG
                        miniMap.frame(maxHeight: .infinity)
                        stopButton
                    }
                    .padding()
                }
                if let f = live.flash { flashBanner(f) }
            }
            .overlay(alignment: .top) { if landscape { statusBar.padding(.horizontal) } }
            .overlay(alignment: .bottomTrailing) { if landscape { stopButton.frame(width: 180).padding() } }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden()
    }

    // MARK: Pieces

    private var statusBar: some View {
        HStack(spacing: 8) {
            PillLabel(text: phaseText, color: phaseColor, systemImage: "flag.checkered")
            PillLabel(
                text: String(format: "%.0f Hz ±%.1fm", live.gpsRate, live.gpsAccuracy),
                color: live.gpsRate >= 5 ? Theme.gain : (live.gpsRate >= 1 ? Theme.warning : Theme.loss),
                systemImage: "location.fill"
            )
            if goPro.isRecording { PillLabel(text: "REC", color: Theme.loss, systemImage: "record.circle") }
            Spacer()
            Text(live.track.name).font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.textSecondary).lineLimit(1)
        }
    }

    private var phaseText: String {
        switch live.phase {
        case .idle, .finished: "Stopped"
        case .waitingForGPS: "Waiting for GPS"
        case .findingLine: "Drive a lap: finding the line"
        case .outLap: "Out lap"
        case .onLap: "Lap \(live.laps.count + 1)"
        }
    }

    private var phaseColor: Color {
        switch live.phase {
        case .onLap: Theme.gain
        case .outLap, .findingLine: Theme.warning
        default: Theme.textSecondary
        }
    }

    private func deltaBlock(large: Bool) -> some View {
        let d = live.reading?.delta
        return VStack(spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(d.map { LapTimeFormat.delta($0) } ?? "±0.00")
                    .font(Theme.mono(large ? 120 : 96, weight: .heavy))
                    .foregroundStyle(Theme.deltaColor(d))
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                trendArrow
            }
            DeltaBar(delta: d, range: deltaRange).frame(height: 18)
            HStack {
                Text(live.reference.map { "vs \(LapTimeFormat.string($0.time))" } ?? "No reference yet: first lap sets it")
                Spacer()
                if let r = live.reading, r.lineOffset > 25 {
                    Label("Off reference line", systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
                }
            }
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(Theme.textSecondary)
        }
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    @ViewBuilder private var trendArrow: some View {
        if let t = live.reading?.trend, abs(t) > 0.01 {
            Image(systemName: t < 0 ? "arrow.down.right" : "arrow.up.right")
                .font(.system(size: 36, weight: .black))
                .foregroundStyle(t < 0 ? Theme.gain : Theme.loss)
        }
    }

    private var timesRow: some View {
        HStack(spacing: 10) {
            StatTile(title: "Lap", value: live.phase == .onLap ? LapTimeFormat.string(live.lapElapsed, decimals: 1) : "--", size: 30)
            StatTile(
                title: "Predicted",
                value: live.reading.map { LapTimeFormat.string($0.predictedLap, decimals: 2) } ?? "--",
                color: Theme.deltaColor(live.reading?.delta), size: 30
            )
            StatTile(title: "Last", value: live.lastLap.map { LapTimeFormat.string($0.time) } ?? "--", size: 22)
            StatTile(
                title: "Best",
                value: live.sessionBest.map { LapTimeFormat.string($0.time) } ?? "--",
                color: Theme.personalBest, size: 22
            )
        }
    }

    private var splits: some View {
        let count = max(live.track.sectors.count + 1, 1)
        return HStack(spacing: 6) {
            ForEach(0..<count, id: \.self) { i in
                let d: Double? = i < live.splitDeltas.count ? live.splitDeltas[i] : nil
                VStack(spacing: 2) {
                    Text("S\(i + 1)").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.textSecondary)
                    Text(d.map { LapTimeFormat.delta($0) } ?? "–").font(Theme.mono(16)).foregroundStyle(Theme.deltaColor(d))
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .background((d.map { $0 < 0 ? Theme.gain : Theme.loss } ?? Theme.surfaceHigh).opacity(d == nil ? 1 : 0.18),
                            in: RoundedRectangle(cornerRadius: 10))
            }
        }
    }

    private var speedAndG: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 0) {
                Text(live.speed.kmh).font(Theme.mono(54, weight: .heavy)).foregroundStyle(.white)
                Text("KM/H").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            GMeter(longG: live.longG, latG: live.latG).frame(width: 90, height: 90)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18))
    }

    private var miniMap: some View {
        Map(interactionModes: []) {
            if let ref = live.reference {
                MapPolyline(coordinates: ref.samples.map(\.position.coordinate)).stroke(Theme.personalBest.opacity(0.6), lineWidth: 3)
            }
            MapPolyline(coordinates: live.trace.suffix(400).map(\.coordinate)).stroke(Theme.accent, lineWidth: 4)
            if let g = live.track.startFinish {
                MapPolyline(coordinates: g.polyline).stroke(.white, lineWidth: 4)
            }
            if let p = live.trace.last {
                Annotation("", coordinate: p.coordinate) {
                    Circle().fill(Theme.accent).frame(width: 14, height: 14).overlay(Circle().stroke(.white, lineWidth: 2))
                }
            }
        }
        .mapStyle(.imagery)
        .clipShape(RoundedRectangle(cornerRadius: 18))
    }

    private var stopButton: some View {
        Text(stopHold ? "Release to cancel" : "Hold to stop")
            .font(.system(size: 16, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Theme.loss.opacity(stopHold ? 1 : 0.25), in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(.white)
            .onLongPressGesture(minimumDuration: 1.2, perform: onStop, onPressingChanged: { stopHold = $0 })
    }

    private func flashBanner(_ text: String) -> some View {
        let pb = text.hasPrefix("PERSONAL BEST")
        return Text(text)
            .font(Theme.mono(34, weight: .heavy))
            .padding(.horizontal, 28)
            .padding(.vertical, 18)
            .background(pb ? Theme.personalBest : Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 20))
            .foregroundStyle(.white)
            .shadow(radius: 20)
            .transition(.scale.combined(with: .opacity))
            .task(id: text) {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                withAnimation { live.clearFlash() }
            }
    }
}

/// Friction-circle G meter.
struct GMeter: View {
    var longG: Double
    var latG: Double
    var maxG: Double = 1.5

    var body: some View {
        GeometryReader { geo in
            let r = min(geo.size.width, geo.size.height) / 2
            let x = -latG / maxG * r      // left-positive → screen left
            let y = -longG / maxG * r     // accel → up, braking → down
            ZStack {
                Circle().stroke(Theme.stroke, lineWidth: 1)
                Circle().stroke(Theme.stroke, lineWidth: 1).scaleEffect(0.66)
                Circle().stroke(Theme.stroke, lineWidth: 1).scaleEffect(0.33)
                Circle()
                    .fill(longG < -0.3 ? Theme.loss : Theme.accent)
                    .frame(width: 14, height: 14)
                    .offset(x: max(-r, min(r, x)), y: max(-r, min(r, y)))
                    .animation(.linear(duration: 0.05), value: longG)
                Text(String(format: "%.1fg", (longG * longG + latG * latG).squareRoot()))
                    .font(Theme.mono(11)).foregroundStyle(Theme.textSecondary).offset(y: r + 8)
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}
