import Foundation

/// A lap turned into a distance-parameterised trace for fast lookup.
public struct ReferenceLap: Sendable {
    public let lap: Lap
    public let projection: LocalProjection
    /// Local positions of each sample.
    public let points: [Vec2]
    /// Cumulative distance along the lap at each sample (m).
    public let distance: [Double]
    /// Time since lap start at each sample (s).
    public let elapsed: [Double]
    public let speed: [Double]

    public init(lap: Lap, projection: LocalProjection) {
        self.lap = lap
        self.projection = projection
        var pts: [Vec2] = []
        var dist: [Double] = []
        var el: [Double] = []
        var sp: [Double] = []
        var d = 0.0
        for (i, s) in lap.samples.enumerated() {
            let p = projection.toLocal(s.position)
            if i > 0 { d += (p - pts[i - 1]).length }
            pts.append(p)
            dist.append(d)
            el.append(s.t - lap.startTime)
            sp.append(s.speed)
        }
        points = pts
        distance = dist
        elapsed = el
        speed = sp
    }

    public var totalDistance: Double { distance.last ?? 0 }
    public var lapTime: Double { lap.time }

    public struct Match: Sendable {
        /// Index of the segment start.
        public var segment: Int
        /// Fraction along the segment.
        public var fraction: Double
        /// Distance along the reference lap.
        public var distance: Double
        /// Reference elapsed time at that distance.
        public var elapsed: Double
        public var referenceSpeed: Double
        /// Perpendicular offset from the reference line (m).
        public var offset: Double
    }

    /// Projects a point onto the reference polyline, searching segments in [from, to).
    public func match(_ p: Vec2, from: Int = 0, to: Int? = nil) -> Match? {
        let end = min(to ?? points.count - 1, points.count - 1)
        guard points.count >= 2, from < end else { return nil }
        var best: Match?
        var bestD = Double.infinity
        for i in max(0, from)..<end {
            let a = points[i], b = points[i + 1]
            let ab = b - a
            let len2 = ab.dot(ab)
            let f = len2 > 0 ? min(1, max(0, (p - a).dot(ab) / len2)) : 0
            let proj = a + ab * f
            let d = (p - proj).length
            if d < bestD {
                bestD = d
                best = Match(
                    segment: i, fraction: f,
                    distance: distance[i] + (distance[i + 1] - distance[i]) * f,
                    elapsed: elapsed[i] + (elapsed[i + 1] - elapsed[i]) * f,
                    referenceSpeed: speed[i] + (speed[i + 1] - speed[i]) * f,
                    offset: d
                )
            }
        }
        return best
    }

    /// Reference elapsed time at a given lap distance (linear interpolation).
    public func elapsed(atDistance d: Double) -> Double {
        guard let last = distance.last, !distance.isEmpty else { return 0 }
        if d <= 0 { return 0 }
        if d >= last { return elapsed.last ?? 0 }
        var lo = 0, hi = distance.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if distance[mid] <= d { lo = mid } else { hi = mid }
        }
        let span = distance[hi] - distance[lo]
        let f = span > 0 ? (d - distance[lo]) / span : 0
        return elapsed[lo] + (elapsed[hi] - elapsed[lo]) * f
    }
}

/// Live predictive delta, RaceChrono / AiM style.
///
/// The current position is projected onto the reference lap (not our own travelled distance,
/// which drifts with a different line). Delta = our elapsed − reference elapsed at that point.
public final class DeltaEngine {
    public struct Reading: Sendable, Equatable {
        /// + = slower than reference, − = faster.
        public var delta: Double
        /// Predicted lap time = reference lap + delta.
        public var predictedLap: Double
        /// d(delta)/dt over the last ~1.5 s. Negative = currently gaining.
        public var trend: Double
        /// Progress through the lap 0...1.
        public var progress: Double
        public var referenceSpeed: Double
        /// Off the reference line by this many meters (pit lane, off-track, wrong layout if large).
        public var lineOffset: Double
    }

    public private(set) var reference: ReferenceLap?
    private var lastSegment = 0
    private var history: [(t: Double, delta: Double)] = []
    /// Beyond this offset the reading is considered unreliable.
    public var maxOffset = 60.0

    public init() {}

    public func setReference(_ lap: Lap?, projection: LocalProjection) {
        reference = lap.map { ReferenceLap(lap: $0, projection: projection) }
        resetLap()
    }

    public func resetLap() {
        lastSegment = 0
        history.removeAll()
    }

    /// - Parameters:
    ///   - sample: current telemetry
    ///   - lapElapsed: time since our lap started
    public func update(sample: TelemetrySample, lapElapsed: Double) -> Reading? {
        guard let ref = reference, ref.points.count > 2 else { return nil }
        let p = ref.projection.toLocal(sample.position)

        // Search a moving window ahead of the last match (fast and avoids snapping to a
        // different part of the track where it passes nearby, e.g. a hairpin or crossover).
        let window = 60
        var m = ref.match(p, from: max(0, lastSegment - 3), to: lastSegment + window)
        if m == nil || m!.offset > maxOffset {
            // Lost: global search, but only accept forward-plausible matches.
            if let g = ref.match(p), g.offset <= maxOffset { m = g }
        }
        guard let match = m, match.offset <= maxOffset else { return nil }
        lastSegment = match.segment

        let delta = lapElapsed - match.elapsed
        history.append((sample.t, delta))
        history.removeAll { sample.t - $0.t > 1.5 }
        var trend = 0.0
        if let first = history.first, sample.t - first.t > 0.2 {
            trend = (delta - first.delta) / (sample.t - first.t)
        }
        return Reading(
            delta: delta,
            predictedLap: ref.lapTime + delta,
            trend: trend,
            progress: ref.totalDistance > 0 ? match.distance / ref.totalDistance : 0,
            referenceSpeed: match.referenceSpeed,
            lineOffset: match.offset
        )
    }

    /// Full delta trace of `lap` vs the reference, sampled every `step` meters of reference distance.
    /// Used for the analysis chart and the AI debrief.
    public static func deltaTrace(lap: Lap, reference: ReferenceLap, step: Double = 10) -> [(distance: Double, delta: Double)] {
        let engine = DeltaEngine()
        engine.reference = reference
        var out: [(distance: Double, delta: Double)] = []
        var nextD = 0.0
        for s in lap.samples {
            guard let r = engine.update(sample: s, lapElapsed: s.t - lap.startTime) else { continue }
            let d = r.progress * reference.totalDistance
            if d >= nextD {
                out.append((d, r.delta))
                nextD = d + step
            }
        }
        return out
    }
}
