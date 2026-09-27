import Foundation

/// A lap sample expressed in reference-lap distance coordinates.
public struct AlignedPoint: Sendable, Equatable {
    public var distance: Double   // along the reference lap (m)
    public var elapsed: Double    // lap time at this point (s)
    public var delta: Double      // vs reference (s)
    public var speed: Double
    public var longG: Double
    public var latG: Double
    public var offset: Double     // meters from reference line
    public var position: GeoPoint
}

public struct Corner: Sendable, Equatable, Codable, Identifiable {
    public var id: Int { number }
    public var number: Int
    public var direction: Direction
    /// Distance range incl. braking zone and exit (m along reference).
    public var start: Double
    public var apex: Double
    public var end: Double
    public var apexPosition: GeoPoint

    public enum Direction: String, Codable, Sendable { case left, right }
}

public struct CornerMetrics: Sendable, Equatable, Codable {
    /// Distance of the braking point (m along reference). Lower = earlier braking.
    public var brakePoint: Double
    public var entrySpeed: Double
    public var minSpeed: Double
    public var minSpeedAt: Double
    public var exitSpeed: Double
    public var maxLatG: Double
    public var peakBrakeG: Double
    /// Time spent from corner start to end.
    public var time: Double
}

public struct CornerComparison: Sendable, Equatable, Codable, Identifiable {
    public var id: Int { corner.number }
    public var corner: Corner
    public var reference: CornerMetrics
    public var lap: CornerMetrics
    /// + = time lost in this corner vs reference.
    public var timeLoss: Double
}

public enum LapAnalysis {
    /// Align every sample of `lap` onto the reference lap's distance axis.
    public static func align(_ lap: Lap, to ref: ReferenceLap) -> [AlignedPoint] {
        let engine = DeltaEngine()
        engine.setReference(ref.lap, projection: ref.projection)
        var out: [AlignedPoint] = []
        for s in lap.samples {
            let el = s.t - lap.startTime
            guard let r = engine.update(sample: s, lapElapsed: el) else { continue }
            let d = r.progress * ref.totalDistance
            // Keep distance monotonic (GPS noise at low speed can step backwards).
            if let last = out.last, d < last.distance { continue }
            out.append(AlignedPoint(
                distance: d, elapsed: el, delta: r.delta, speed: s.speed,
                longG: s.longG, latG: s.latG, offset: r.lineOffset, position: s.position
            ))
        }
        return out
    }

    /// Detect corners on a (reference) lap from heading change per meter.
    public static func detectCorners(in ref: ReferenceLap, minCurvature: Double = 0.2, minLength: Double = 12) -> [Corner] {
        let n = ref.points.count
        guard n > 5 else { return [] }
        // Heading of each segment
        var heading = [Double](repeating: 0, count: n)
        for i in 0..<(n - 1) {
            let d = ref.points[i + 1] - ref.points[i]
            heading[i] = Geo.rad2deg(atan2(d.x, d.y))
        }
        heading[n - 1] = heading[n - 2]

        // Curvature deg/m over a ±15 m window (robust to GPS noise).
        var curv = [Double](repeating: 0, count: n)
        var lo = 0, hi = 0
        for i in 0..<n {
            while lo < i, ref.distance[i] - ref.distance[lo] > 15 { lo += 1 }
            while hi < n - 1, ref.distance[hi] - ref.distance[i] < 15 { hi += 1 }
            let dd = ref.distance[hi] - ref.distance[lo]
            if dd > 1 { curv[i] = Geo.angleDiff(heading[lo], heading[hi]) / dd }
        }

        // Segment into turning regions.
        struct Region { var a: Int; var b: Int; var sign: Double }
        var regions: [Region] = []
        var i = 0
        while i < n {
            if abs(curv[i]) >= minCurvature {
                let sign = curv[i] > 0 ? 1.0 : -1.0
                var j = i
                while j + 1 < n, abs(curv[j + 1]) >= minCurvature * 0.6, (curv[j + 1] > 0 ? 1.0 : -1.0) == sign { j += 1 }
                if ref.distance[j] - ref.distance[i] >= minLength {
                    if var last = regions.last, last.sign == sign, ref.distance[i] - ref.distance[last.b] < 25 {
                        last.b = j
                        regions[regions.count - 1] = last
                    } else {
                        regions.append(Region(a: i, b: j, sign: sign))
                    }
                }
                i = j + 1
            } else {
                i += 1
            }
        }

        var corners: [Corner] = []
        for (k, r) in regions.enumerated() {
            // Apex = min speed within the turning region.
            let apexIdx = (r.a...r.b).min { ref.speed[$0] < ref.speed[$1] } ?? r.a
            // Extend back to braking start: max speed within 350 m before apex.
            var brakeIdx = r.a
            var j = apexIdx
            var vmax = ref.speed[apexIdx]
            while j > 0, ref.distance[apexIdx] - ref.distance[j] < 350 {
                j -= 1
                if ref.speed[j] >= vmax { vmax = ref.speed[j]; brakeIdx = j }
            }
            let prevEnd = corners.last?.end ?? 0
            let start = max(min(ref.distance[brakeIdx], ref.distance[r.a]), prevEnd)
            let end = min(ref.distance[r.b] + 40, ref.totalDistance)
            corners.append(Corner(
                number: k + 1,
                direction: r.sign > 0 ? .right : .left,
                start: start, apex: ref.distance[apexIdx], end: end,
                apexPosition: ref.projection.toGeo(ref.points[apexIdx])
            ))
        }
        return corners
    }

    static func metrics(_ pts: [AlignedPoint], corner c: Corner) -> CornerMetrics? {
        let inRange = pts.filter { $0.distance >= c.start && $0.distance <= c.end }
        guard inRange.count >= 2, let first = inRange.first, let last = inRange.last else { return nil }
        let minP = inRange.min { $0.speed < $1.speed }!
        let beforeApex = inRange.filter { $0.distance <= minP.distance }
        let maxP = beforeApex.max { $0.speed < $1.speed } ?? first
        return CornerMetrics(
            brakePoint: maxP.distance,
            entrySpeed: maxP.speed,
            minSpeed: minP.speed,
            minSpeedAt: minP.distance,
            exitSpeed: last.speed,
            maxLatG: inRange.map { abs($0.latG) }.max() ?? 0,
            peakBrakeG: -(inRange.map(\.longG).min() ?? 0),
            time: last.elapsed - first.elapsed
        )
    }

    /// Per-corner comparison of `lap` against the reference.
    public static func compare(_ lap: Lap, reference ref: ReferenceLap, corners: [Corner]? = nil) -> [CornerComparison] {
        let cs = corners ?? detectCorners(in: ref)
        let refPts = align(ref.lap, to: ref)
        let lapPts = align(lap, to: ref)
        return cs.compactMap { c in
            guard let rm = metrics(refPts, corner: c), let lm = metrics(lapPts, corner: c) else { return nil }
            return CornerComparison(corner: c, reference: rm, lap: lm, timeLoss: lm.time - rm.time)
        }
    }

    /// "Ideal line": for each corner segment, take the path of whichever lap was fastest through it.
    /// Returns the stitched coordinates and the theoretical time. Based purely on the driver's own
    /// laps, so every piece of it is a line they have actually driven.
    public static func idealLine(laps: [Lap], reference ref: ReferenceLap) -> (path: [GeoPoint], time: Double, sources: [Int]) {
        let corners = detectCorners(in: ref)
        var bounds = [0.0]
        for c in corners { bounds.append(c.end) }
        bounds.append(ref.totalDistance)
        bounds = Array(Set(bounds)).sorted()

        let aligned = laps.filter(\.isValid).map { ($0.number, align($0, to: ref)) }
        var path: [GeoPoint] = []
        var total = 0.0
        var sources: [Int] = []
        for k in 0..<(bounds.count - 1) {
            let a = bounds[k], b = bounds[k + 1]
            var best: (Int, Double, [GeoPoint])?
            for (num, pts) in aligned {
                let seg = pts.filter { $0.distance >= a && $0.distance <= b }
                guard let f = seg.first, let l = seg.last, l.distance - f.distance > (b - a) * 0.8 else { continue }
                let t = l.elapsed - f.elapsed
                if best == nil || t < best!.1 { best = (num, t, seg.map(\.position)) }
            }
            if let b = best {
                total += b.1
                path += b.2
                sources.append(b.0)
            }
        }
        return (path, total, sources)
    }
}
