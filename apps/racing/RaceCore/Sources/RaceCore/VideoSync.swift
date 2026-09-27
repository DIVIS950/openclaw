import Foundation

/// Aligns a video (GoPro) with a recorded session so the onboard overlay is frame-accurate.
///
/// Convention: `sessionTime = videoTime + offset`.
///
/// Strategy, most to least precise:
/// 1. Speed-trace cross-correlation between GoPro GPS (GPMF) and the session (≈ ±0.05 s).
///    Speed is used rather than position because it is independent of GPS lateral error and
///    has a very distinctive shape (braking zones) — the same technique used by pro data tools.
/// 2. Absolute UTC from GoPro GPS vs session wall clock (≈ ±0.2 s), used as the search seed.
/// 3. Recording-start timestamp from the BLE shutter command (≈ ±0.5 s) when the camera had no GPS lock.
public enum VideoSync {
    public enum Method: String, Codable, Sendable {
        case speedCorrelation, gpsUTC, shutterTimestamp, manual
    }

    public struct Result: Codable, Sendable, Equatable {
        public var offset: Double
        /// Normalised cross-correlation 0...1 (1 for non-correlation methods).
        public var confidence: Double
        public var method: Method

        public init(offset: Double, confidence: Double, method: Method) {
            self.offset = offset
            self.confidence = confidence
            self.method = method
        }
    }

    /// Linear resample of (t, value) pairs onto a uniform grid.
    public static func resample(_ pts: [(t: Double, v: Double)], from t0: Double, to t1: Double, step: Double) -> [Double] {
        guard pts.count > 1, t1 > t0 else { return [] }
        var out: [Double] = []
        out.reserveCapacity(Int((t1 - t0) / step) + 1)
        var j = 0
        var t = t0
        while t <= t1 {
            while j < pts.count - 2, pts[j + 1].t < t { j += 1 }
            let a = pts[j], b = pts[j + 1]
            if t <= a.t { out.append(a.v) }
            else if t >= b.t { out.append(b.v) }
            else { out.append(a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t)) }
            t += step
        }
        return out
    }

    /// Normalised cross-correlation of `a` against `b` shifted by `lag` samples (b[i+lag] vs a[i]).
    static func ncc(_ a: [Double], _ b: [Double], lag: Int, minOverlap: Int) -> Double? {
        let start = max(0, -lag)
        let end = min(a.count, b.count - lag)
        let n = end - start
        guard n >= minOverlap else { return nil }
        var sa = 0.0, sb = 0.0
        for i in start..<end { sa += a[i]; sb += b[i + lag] }
        let ma = sa / Double(n), mb = sb / Double(n)
        var num = 0.0, da = 0.0, db = 0.0
        for i in start..<end {
            let x = a[i] - ma, y = b[i + lag] - mb
            num += x * y; da += x * x; db += y * y
        }
        guard da > 1e-9, db > 1e-9 else { return nil }
        return num / (da * db).squareRoot()
    }

    /// - Parameters:
    ///   - video: GoPro (videoTime, speed m/s)
    ///   - session: (sessionTime, speed m/s)
    ///   - seed: expected offset if known (from UTC); search is ±`window` around it,
    ///           otherwise across the whole session.
    public static func correlate(
        video: [(t: Double, v: Double)],
        session: [(t: Double, v: Double)],
        seed: Double? = nil,
        window: Double = 20
    ) -> Result? {
        guard let v0 = video.first?.t, let v1 = video.last?.t,
              let s0 = session.first?.t, let s1 = session.last?.t else { return nil }

        func search(step: Double, range: ClosedRange<Double>) -> (offset: Double, score: Double)? {
            let a = resample(video, from: v0, to: v1, step: step)
            let b = resample(session, from: s0, to: s1, step: step)
            let minOverlap = max(10, Int(min(30, (v1 - v0) * 0.5) / step))
            var best: (Double, Double)?
            // b index k ↔ session time s0 + k*step ; a index i ↔ video time v0 + i*step
            // offset = (s0 + (i+lag)*step) - (v0 + i*step) = s0 - v0 + lag*step
            let lagLo = Int(((range.lowerBound - (s0 - v0)) / step).rounded(.down))
            let lagHi = Int(((range.upperBound - (s0 - v0)) / step).rounded(.up))
            guard lagLo <= lagHi else { return nil }
            for lag in lagLo...lagHi {
                guard let c = ncc(a, b, lag: lag, minOverlap: minOverlap) else { continue }
                if best == nil || c > best!.1 { best = (s0 - v0 + Double(lag) * step, c) }
            }
            return best.map { (offset: $0.0, score: $0.1) }
        }

        let coarseRange: ClosedRange<Double> = seed.map { ($0 - window)...($0 + window) }
            ?? ((s0 - v1)...(s1 - v0))
        guard let coarse = search(step: 0.5, range: coarseRange) else { return nil }
        let fine = search(step: 0.05, range: (coarse.offset - 1)...(coarse.offset + 1)) ?? coarse
        return Result(offset: fine.offset, confidence: max(0, fine.score), method: .speedCorrelation)
    }

    /// UTC-based seed: offset = (videoUTC - sessionStartWall) - videoTime.
    public static func utcOffset(points: [GPMFParser.GPSPoint], sessionStart: Date) -> Result? {
        let withUTC = points.filter { $0.utc != nil }
        guard !withUTC.isEmpty else { return nil }
        // Median for robustness against the GPSU 1 s granularity on older cameras.
        let offsets = withUTC.map { $0.utc!.timeIntervalSince(sessionStart) - $0.videoTime }.sorted()
        return Result(offset: offsets[offsets.count / 2], confidence: 1, method: .gpsUTC)
    }
}
