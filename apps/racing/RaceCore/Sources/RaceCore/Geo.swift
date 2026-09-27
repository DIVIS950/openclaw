import Foundation

/// WGS-84 coordinate in degrees.
public struct GeoPoint: Codable, Hashable, Sendable {
    public var lat: Double
    public var lon: Double

    public init(lat: Double, lon: Double) {
        self.lat = lat
        self.lon = lon
    }
}

/// 2D vector in a local East-North metric frame (meters).
public struct Vec2: Codable, Hashable, Sendable {
    public var x: Double
    public var y: Double

    public init(_ x: Double, _ y: Double) {
        self.x = x
        self.y = y
    }

    public static let zero = Vec2(0, 0)

    public static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
    public static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
    public static func * (a: Vec2, s: Double) -> Vec2 { Vec2(a.x * s, a.y * s) }

    public var length: Double { (x * x + y * y).squareRoot() }
    public func dot(_ o: Vec2) -> Double { x * o.x + y * o.y }
    /// Z component of the 3D cross product; sign tells which side `o` lies on.
    public func cross(_ o: Vec2) -> Double { x * o.y - y * o.x }
    public var normalized: Vec2 {
        let l = length
        return l > 0 ? Vec2(x / l, y / l) : .zero
    }
}

public enum Geo {
    public static let earthRadius = 6_371_008.8

    public static func deg2rad(_ d: Double) -> Double { d * .pi / 180 }
    public static func rad2deg(_ r: Double) -> Double { r * 180 / .pi }

    /// Great-circle distance in meters.
    public static func distance(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let dLat = deg2rad(b.lat - a.lat)
        let dLon = deg2rad(b.lon - a.lon)
        let s = sin(dLat / 2) * sin(dLat / 2)
            + cos(deg2rad(a.lat)) * cos(deg2rad(b.lat)) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadius * atan2(s.squareRoot(), (1 - s).squareRoot())
    }

    /// Initial bearing a→b in degrees clockwise from true north, 0..<360.
    public static func bearing(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let p1 = deg2rad(a.lat), p2 = deg2rad(b.lat)
        let dl = deg2rad(b.lon - a.lon)
        let y = sin(dl) * cos(p2)
        let x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
        return normalizeDegrees(rad2deg(atan2(y, x)))
    }

    public static func normalizeDegrees(_ d: Double) -> Double {
        let r = d.truncatingRemainder(dividingBy: 360)
        return r < 0 ? r + 360 : r
    }

    /// Signed smallest difference b-a in degrees, range (-180, 180].
    public static func angleDiff(_ a: Double, _ b: Double) -> Double {
        var d = (b - a).truncatingRemainder(dividingBy: 360)
        if d > 180 { d -= 360 }
        if d <= -180 { d += 360 }
        return d
    }

    /// Destination point given start, bearing (deg) and distance (m).
    public static func destination(_ p: GeoPoint, bearing: Double, distance: Double) -> GeoPoint {
        let d = distance / earthRadius
        let b = deg2rad(bearing)
        let la1 = deg2rad(p.lat), lo1 = deg2rad(p.lon)
        let la2 = asin(sin(la1) * cos(d) + cos(la1) * sin(d) * cos(b))
        let lo2 = lo1 + atan2(sin(b) * sin(d) * cos(la1), cos(d) - sin(la1) * sin(la2))
        return GeoPoint(lat: rad2deg(la2), lon: rad2deg(lo2))
    }
}

/// Local tangent-plane projection (East-North) around an origin.
/// Uses a local ellipsoidal scale, which is accurate to millimeters over a few km —
/// more than enough for a race track and much cheaper than full ECEF→ENU per sample.
public struct LocalProjection: Codable, Hashable, Sendable {
    public let origin: GeoPoint
    private let metersPerDegLat: Double
    private let metersPerDegLon: Double

    public init(origin: GeoPoint) {
        self.origin = origin
        // WGS-84 meridional / prime-vertical radii of curvature at origin latitude.
        let a = 6_378_137.0
        let e2 = 0.00669437999014
        let phi = Geo.deg2rad(origin.lat)
        let s = sin(phi)
        let w = (1 - e2 * s * s).squareRoot()
        let m = a * (1 - e2) / (w * w * w)
        let n = a / w
        metersPerDegLat = Geo.deg2rad(1) * m
        metersPerDegLon = Geo.deg2rad(1) * n * cos(phi)
    }

    public func toLocal(_ p: GeoPoint) -> Vec2 {
        Vec2((p.lon - origin.lon) * metersPerDegLon, (p.lat - origin.lat) * metersPerDegLat)
    }

    public func toGeo(_ v: Vec2) -> GeoPoint {
        GeoPoint(lat: origin.lat + v.y / metersPerDegLat, lon: origin.lon + v.x / metersPerDegLon)
    }
}
