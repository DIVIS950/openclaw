import Foundation

public enum VehicleClass: String, Codable, CaseIterable, Sendable {
    case car, kart, sim

    public var displayName: String {
        switch self {
        case .car: "Car"
        case .kart: "Kart"
        case .sim: "Sim"
        }
    }
}

public struct Vehicle: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var vehicleClass: VehicleClass
    /// Free text for the coach: "RWD, 300 hp, semi-slicks, no ABS" / "Rotax Max 125, 4 stroke"
    public var setup: String

    public init(id: UUID = UUID(), name: String, vehicleClass: VehicleClass, setup: String = "") {
        self.id = id
        self.name = name
        self.vehicleClass = vehicleClass
        self.setup = setup
    }
}

public struct VideoLink: Codable, Hashable, Sendable {
    /// File name inside the app's Videos directory.
    public var fileName: String
    public var sync: VideoSync.Result
    public var duration: Double

    public init(fileName: String, sync: VideoSync.Result, duration: Double) {
        self.fileName = fileName
        self.sync = sync
        self.duration = duration
    }
}

public struct Session: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var trackID: String
    public var trackName: String
    public var vehicle: Vehicle?
    /// Wall clock at session time 0.
    public var startDate: Date
    public var laps: [Lap]
    /// Complete raw trace including out/in laps and pit (thinned to ≤ 25 Hz).
    public var samples: [TelemetrySample]
    public var video: VideoLink?
    public var conditions: String
    public var notes: String
    /// Cached AI debrief text.
    public var debrief: String?

    public init(
        id: UUID = UUID(), trackID: String, trackName: String, vehicle: Vehicle? = nil,
        startDate: Date, laps: [Lap] = [], samples: [TelemetrySample] = [], video: VideoLink? = nil,
        conditions: String = "", notes: String = "", debrief: String? = nil
    ) {
        self.id = id
        self.trackID = trackID
        self.trackName = trackName
        self.vehicle = vehicle
        self.startDate = startDate
        self.laps = laps
        self.samples = samples
        self.video = video
        self.conditions = conditions
        self.notes = notes
        self.debrief = debrief
    }

    public var bestLap: Lap? { LapStats.best(laps) }
    public var theoreticalBest: Double? { LapStats.theoreticalBest(laps) }

    /// Telemetry sample closest to session time `t` (binary search + interpolation).
    public func sample(at t: Double) -> TelemetrySample? {
        guard let first = samples.first, let last = samples.last else { return nil }
        if t <= first.t { return first }
        if t >= last.t { return last }
        var lo = 0, hi = samples.count - 1
        while hi - lo > 1 {
            let m = (lo + hi) / 2
            if samples[m].t <= t { lo = m } else { hi = m }
        }
        let a = samples[lo], b = samples[hi]
        let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
        return TelemetrySample.lerp(a, b, f)
    }

    /// Lap that is running at session time `t`.
    public func lap(at t: Double) -> Lap? {
        laps.first { t >= $0.startTime && t <= $0.endTime }
    }
}

/// CSV / GPX export for other tools (RaceChrono, Harry's, Circuit Tools, Excel).
public enum SessionExport {
    public static func csv(_ s: Session) -> String {
        var out = "time_s,utc,lap,lat,lon,alt_m,speed_kmh,heading_deg,long_g,lat_g,accuracy_m,source\n"
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        for p in s.samples {
            let lapNo = s.lap(at: p.t)?.number ?? 0
            let row = String(
                format: "%.3f,%@,%d,%.8f,%.8f,%.1f,%.2f,%.1f,%.3f,%.3f,%.2f,%@\n",
                p.t, iso.string(from: s.startDate.addingTimeInterval(p.t)), lapNo,
                p.position.lat, p.position.lon, p.altitude, p.speedKmh,
                p.heading.isNaN ? -1 : p.heading, p.longG, p.latG, p.accuracy, p.source.rawValue
            )
            out += row
        }
        return out
    }

    public static func gpx(_ s: Session) -> String {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var out = """
        <?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="Apex Racing" xmlns="http://www.topografix.com/GPX/1/1">
        <trk><name>\(xmlEscape(s.trackName))</name>

        """
        for lap in s.laps {
            out += "<trkseg>\n"
            for p in lap.samples {
                out += String(format: "<trkpt lat=\"%.8f\" lon=\"%.8f\"><ele>%.1f</ele><time>%@</time><speed>%.2f</speed></trkpt>\n",
                              p.position.lat, p.position.lon, p.altitude,
                              iso.string(from: s.startDate.addingTimeInterval(p.t)), p.speed)
            }
            out += "</trkseg>\n"
        }
        out += "</trk>\n</gpx>\n"
        return out
    }

    static func xmlEscape(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}
