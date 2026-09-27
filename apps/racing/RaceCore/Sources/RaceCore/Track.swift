import Foundation

public enum TrackKind: String, Codable, CaseIterable, Sendable {
    case circuit
    case kart
    case hillclimb   // point-to-point
    case custom
}

/// A timing gate: a line segment the vehicle must cross.
/// Stored as a center point + direction of travel + width so users can place it with one tap.
public struct Gate: Codable, Hashable, Sendable {
    public var center: GeoPoint
    /// direction of travel across the gate, degrees true
    public var heading: Double
    /// gate width in meters (track width + margin)
    public var width: Double

    public init(center: GeoPoint, heading: Double, width: Double = 30) {
        self.center = center
        self.heading = heading
        self.width = width
    }

    /// The two gate end points (perpendicular to the direction of travel).
    public var endpoints: (GeoPoint, GeoPoint) {
        let left = Geo.destination(center, bearing: heading - 90, distance: width / 2)
        let right = Geo.destination(center, bearing: heading + 90, distance: width / 2)
        return (left, right)
    }
}

public struct Track: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var country: String
    public var city: String
    public var kind: TrackKind
    /// Official lap length in meters (0 if unknown).
    public var length: Double
    /// Track center used for auto-detection and map framing.
    public var location: GeoPoint
    /// Start/finish gate. `nil` = not surveyed yet; the user sets it on the satellite map.
    public var startFinish: Gate?
    /// Separate finish for point-to-point tracks.
    public var finish: Gate?
    /// Split gates in lap order (not including start/finish).
    public var sectors: [Gate]
    /// Optional reference centerline (local ENU not stored; raw lat/lon).
    public var centerline: [GeoPoint]
    /// Short notes for the AI coach (characteristic corners, surface, known bumps).
    public var notes: String
    public var isUserDefined: Bool

    public init(
        id: String,
        name: String,
        country: String,
        city: String = "",
        kind: TrackKind,
        length: Double,
        location: GeoPoint,
        startFinish: Gate? = nil,
        finish: Gate? = nil,
        sectors: [Gate] = [],
        centerline: [GeoPoint] = [],
        notes: String = "",
        isUserDefined: Bool = false
    ) {
        self.id = id
        self.name = name
        self.country = country
        self.city = city
        self.kind = kind
        self.length = length
        self.location = location
        self.startFinish = startFinish
        self.finish = finish
        self.sectors = sectors
        self.centerline = centerline
        self.notes = notes
        self.isUserDefined = isUserDefined
    }

    public var isPointToPoint: Bool { finish != nil }
    public var isTimingReady: Bool { startFinish != nil }
    public var projection: LocalProjection { LocalProjection(origin: location) }
}

public enum TrackLocator {
    /// Closest track to a position within `radius` meters (default 3 km).
    public static func nearest(to p: GeoPoint, in tracks: [Track], radius: Double = 3000) -> Track? {
        tracks
            .map { ($0, Geo.distance($0.location, p)) }
            .filter { $0.1 <= radius }
            .min { $0.1 < $1.1 }?
            .0
    }

    /// Guesses a start/finish gate from a recorded out-lap + flying lap: the point where the
    /// driver first returns within 15 m of a previously visited location after driving > 500 m.
    /// Useful for unsurveyed tracks ("drive one lap, we'll find the line").
    public static func inferStartFinish(from samples: [TelemetrySample], width: Double = 30) -> Gate? {
        guard samples.count > 20 else { return nil }
        var travelled = 0.0
        for i in 1..<samples.count {
            travelled += Geo.distance(samples[i - 1].position, samples[i].position)
            guard travelled > 500 else { continue }
            // look for a close earlier point with similar heading
            let cur = samples[i]
            var runDist = 0.0
            for j in 1..<i {
                runDist += Geo.distance(samples[j - 1].position, samples[j].position)
                if travelled - runDist < 400 { break }
                let s = samples[j]
                if Geo.distance(s.position, cur.position) < 15,
                   !s.heading.isNaN, !cur.heading.isNaN,
                   abs(Geo.angleDiff(s.heading, cur.heading)) < 30
                {
                    return Gate(center: s.position, heading: s.heading, width: width)
                }
            }
        }
        return nil
    }
}
