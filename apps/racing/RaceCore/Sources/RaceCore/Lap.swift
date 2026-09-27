import Foundation

public struct Lap: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    /// 1-based lap number within the session (0 = out lap).
    public var number: Int
    /// Session time (s) at which the car crossed start/finish (interpolated).
    public var startTime: Double
    public var endTime: Double
    /// Cumulative split times from lap start at each sector gate, followed by the lap time.
    /// e.g. [31.2, 58.9, 92.4] for a 3-sector track (2 split gates + finish).
    public var splits: [Double]
    /// Samples from start to finish; first/last are the interpolated gate crossings.
    public var samples: [TelemetrySample]
    /// Set by the driver/analysis (off-track, pit lane, yellow flag...).
    public var isValid: Bool

    public init(
        id: UUID = UUID(), number: Int, startTime: Double, endTime: Double,
        splits: [Double], samples: [TelemetrySample], isValid: Bool = true
    ) {
        self.id = id
        self.number = number
        self.startTime = startTime
        self.endTime = endTime
        self.splits = splits
        self.samples = samples
        self.isValid = isValid
    }

    public var time: Double { endTime - startTime }

    /// Individual sector durations derived from the cumulative splits.
    public var sectorTimes: [Double] {
        var out: [Double] = []
        var prev = 0.0
        for s in splits {
            out.append(s - prev)
            prev = s
        }
        return out
    }

    public var maxSpeed: Double { samples.map(\.speed).max() ?? 0 }
    public var minSpeed: Double { samples.map(\.speed).min() ?? 0 }
    public var distance: Double {
        zip(samples, samples.dropFirst()).reduce(0) { $0 + Geo.distance($1.0.position, $1.1.position) }
    }
}

public enum LapTimeFormat {
    /// 1:42.357 or 58.204
    public static func string(_ seconds: Double, decimals: Int = 3) -> String {
        guard seconds.isFinite else { return "--:--.---" }
        let s = max(0, seconds)
        let minutes = Int(s / 60)
        let rest = s - Double(minutes * 60)
        let secFmt = String(format: "%0\(decimals + 3).\(decimals)f", rest)
        return minutes > 0 ? "\(minutes):\(secFmt)" : String(format: "%.\(decimals)f", rest)
    }

    /// +0.23 / -1.05
    public static func delta(_ d: Double, decimals: Int = 2) -> String {
        guard d.isFinite else { return "--" }
        return String(format: "%+.\(decimals)f", d)
    }
}

/// Best laps / theoretical best across a set of laps.
public enum LapStats {
    public static func best(_ laps: [Lap]) -> Lap? {
        laps.filter(\.isValid).min { $0.time < $1.time }
    }

    /// Sum of best individual sectors ("ideal lap", "optimal lap").
    public static func theoreticalBest(_ laps: [Lap]) -> Double? {
        let valid = laps.filter(\.isValid)
        guard let n = valid.map({ $0.splits.count }).max(), n > 0 else { return nil }
        var total = 0.0
        for i in 0..<n {
            let bests = valid.compactMap { $0.sectorTimes.count > i ? $0.sectorTimes[i] : nil }
            guard let b = bests.min() else { return nil }
            total += b
        }
        return total
    }

    /// Best time for each sector index.
    public static func bestSectors(_ laps: [Lap]) -> [Double] {
        let valid = laps.filter(\.isValid)
        let n = valid.map { $0.splits.count }.max() ?? 0
        return (0..<n).map { i in
            valid.compactMap { $0.sectorTimes.count > i ? $0.sectorTimes[i] : nil }.min() ?? .infinity
        }
    }
}
