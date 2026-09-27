import Foundation

/// Precise line-crossing detection.
public enum GateCrossing {
    /// Returns the fraction (0...1) along prev→cur at which the path crosses `gate`
    /// in the gate's direction of travel, or nil if it does not.
    public static func crossing(
        from prev: GeoPoint, to cur: GeoPoint, gate: Gate, projection: LocalProjection
    ) -> Double? {
        let p = projection.toLocal(prev)
        let r = projection.toLocal(cur) - p
        let (l, rt) = gate.endpoints
        let q = projection.toLocal(l)
        let s = projection.toLocal(rt) - q

        let denom = r.cross(s)
        guard abs(denom) > 1e-9 else { return nil } // parallel
        let qp = q - p
        let t = qp.cross(s) / denom
        let u = qp.cross(r) / denom
        guard (0...1).contains(t), (0...1).contains(u) else { return nil }

        // Only count crossings in the direction of travel (ignores reversing / pit exit going backwards).
        let h = Geo.deg2rad(gate.heading)
        let dir = Vec2(sin(h), cos(h))
        guard r.dot(dir) > 0 else { return nil }
        return t
    }
}

/// Stateful lap timer. Feed it samples in time order; it emits timing events.
///
/// Timing precision comes from interpolating the exact crossing between two fixes, so a
/// 25 Hz receiver gives ~±0.01 s and fused 1 Hz phone GPS + IMU gives ~±0.05 s.
public final class LapTimer {
    public enum Event: Equatable {
        case gateInferred(Gate)
        case lapStarted(number: Int, at: Double)
        case split(lap: Int, index: Int, time: Double)
        case lapCompleted(Lap)
    }

    public private(set) var track: Track
    public private(set) var laps: [Lap] = []
    /// Session time at which the current lap started, nil while on the out-lap.
    public private(set) var currentLapStart: Double?
    public private(set) var currentSplits: [Double] = []
    public private(set) var currentSamples: [TelemetrySample] = []

    /// Minimum lap time to accept a start/finish crossing (debounce against GPS jitter at the line).
    public var minLapTime: Double

    private let projection: LocalProjection
    private var last: TelemetrySample?
    private var nextSectorIndex = 0
    private var inferenceBuffer: [TelemetrySample] = []
    private var lastInferenceAt = 0.0

    public init(track: Track, minLapTime: Double? = nil) {
        self.track = track
        self.projection = track.projection
        self.minLapTime = minLapTime ?? (track.kind == .kart ? 15 : 25)
    }

    public var currentLapNumber: Int { laps.count + 1 }

    /// Elapsed time of the running lap at session time `t`.
    public func elapsed(at t: Double) -> Double? {
        currentLapStart.map { t - $0 }
    }

    @discardableResult
    public func ingest(_ s: TelemetrySample) -> [Event] {
        defer { last = s }
        var events: [Event] = []

        guard let startGate = track.startFinish else {
            if let g = inferGate(with: s) {
                track.startFinish = g
                events.append(.gateInferred(g))
            }
            return events
        }
        guard let prev = last else {
            return events
        }

        // Point-to-point finish gate.
        if let finish = track.finish, let start = currentLapStart,
           let f = GateCrossing.crossing(from: prev.position, to: s.position, gate: finish, projection: projection)
        {
            let x = TelemetrySample.lerp(prev, s, f)
            events.append(contentsOf: finishLap(at: x, lapStart: start))
            currentLapStart = nil
            return events
        }

        // Sector splits (in order only).
        if let start = currentLapStart, nextSectorIndex < track.sectors.count,
           let f = GateCrossing.crossing(
               from: prev.position, to: s.position, gate: track.sectors[nextSectorIndex], projection: projection)
        {
            let x = TelemetrySample.lerp(prev, s, f)
            let split = x.t - start
            currentSplits.append(split)
            events.append(.split(lap: currentLapNumber, index: nextSectorIndex, time: split))
            nextSectorIndex += 1
        }

        if let f = GateCrossing.crossing(from: prev.position, to: s.position, gate: startGate, projection: projection) {
            let x = TelemetrySample.lerp(prev, s, f)
            if let start = currentLapStart, !track.isPointToPoint {
                if x.t - start >= minLapTime {
                    events.append(contentsOf: finishLap(at: x, lapStart: start))
                    beginLap(at: x)
                    events.append(.lapStarted(number: currentLapNumber, at: x.t))
                }
            } else if currentLapStart == nil {
                beginLap(at: x)
                events.append(.lapStarted(number: currentLapNumber, at: x.t))
            }
        }

        if currentLapStart != nil {
            currentSamples.append(s)
        }
        return events
    }

    /// Mark the running lap as aborted (e.g. entering the pits).
    public func abortLap() {
        currentLapStart = nil
        currentSamples = []
        currentSplits = []
        nextSectorIndex = 0
    }

    private func beginLap(at x: TelemetrySample) {
        currentLapStart = x.t
        currentSamples = [x]
        currentSplits = []
        nextSectorIndex = 0
    }

    private func finishLap(at x: TelemetrySample, lapStart: Double) -> [Event] {
        var samples = currentSamples
        samples.append(x)
        // Sector splits only count if every gate was hit; otherwise keep just the lap time.
        var splits = currentSplits.count == track.sectors.count ? currentSplits : []
        splits.append(x.t - lapStart)
        let lap = Lap(
            number: currentLapNumber, startTime: lapStart, endTime: x.t,
            splits: splits, samples: samples
        )
        laps.append(lap)
        return [.lapCompleted(lap)]
    }

    /// Unsurveyed track: collect a thinned trace and look for the first closed loop.
    private func inferGate(with s: TelemetrySample) -> Gate? {
        if let lastKept = inferenceBuffer.last {
            guard Geo.distance(lastKept.position, s.position) >= 3 else { return nil }
        }
        inferenceBuffer.append(s)
        guard s.t - lastInferenceAt > 5 else { return nil }
        lastInferenceAt = s.t
        let gate = TrackLocator.inferStartFinish(from: inferenceBuffer)
        if gate != nil { inferenceBuffer = [] }
        return gate
    }
}
