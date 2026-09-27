import Foundation
@testable import RaceCore

/// Synthetic "stadium" track: two 300 m straights joined by two 50 m-radius hairpins,
/// driven clockwise, centered on a real-world origin. Used to generate exact ground truth.
enum Stadium {
    static let origin = GeoPoint(lat: 49.2031, lon: 16.4444)
    static let straight = 300.0
    static let radius = 50.0
    static var length: Double { 2 * straight + 2 * .pi * radius }
    static let projection = LocalProjection(origin: origin)

    /// Position (local ENU) and heading (deg) at distance s along the lap.
    /// Lap starts at the middle of the bottom straight heading east (clockwise = right-hand turns).
    static func pose(_ sIn: Double) -> (Vec2, Double) {
        var s = sIn.truncatingRemainder(dividingBy: length)
        if s < 0 { s += length }
        let half = straight / 2
        // Bottom straight (y = -R), heading west... we go counter to make turns right-handed:
        // Travel west along bottom (heading 270), turn right up the left hairpin (north), top straight east (90),
        // right hairpin down (south) back to the bottom.
        if s < half { return (Vec2(-s, -radius), 270) }
        s -= half
        let arc = Double.pi * radius
        if s < arc {
            // left hairpin, center (-half, 0), from angle -90° going clockwise? we move from bottom to top on the west side.
            let a = s / radius // 0...pi
            let x = -half - radius * sin(a)
            let y = -radius * cos(a)
            return (Vec2(x, y), Geo.normalizeDegrees(270 + Geo.rad2deg(a)))
        }
        s -= arc
        if s < straight { return (Vec2(-half + s, radius), 90) }
        s -= straight
        if s < arc {
            let a = s / radius
            let x = half + radius * sin(a)
            let y = radius * cos(a)
            return (Vec2(x, y), Geo.normalizeDegrees(90 + Geo.rad2deg(a)))
        }
        s -= arc
        return (Vec2(half - s, -radius), 270)
    }

    static func isCorner(_ sIn: Double) -> Bool {
        var s = sIn.truncatingRemainder(dividingBy: length)
        if s < 0 { s += length }
        let half = straight / 2, arc = Double.pi * radius
        return (s >= half && s < half + arc) || (s >= half + arc + straight && s < half + 2 * arc + straight)
    }

    /// Simulated drive. `slowFactor` scales speeds (1.0 = reference pace).
    static func drive(laps: Int, hz: Double = 10, slowFactor: Double = 1.0, startDistance: Double = -50) -> [TelemetrySample] {
        var out: [TelemetrySample] = []
        var s = startDistance
        var t = 0.0
        let dt = 1 / hz
        let end = startDistance + Double(laps) * length + 60
        while s < end {
            let v = (isCorner(s) ? 18.0 : 40.0) / slowFactor
            let (p, h) = pose(s)
            out.append(TelemetrySample(
                t: t, position: projection.toGeo(p), speed: v, heading: h, accuracy: 1, source: .imported
            ))
            s += v * dt
            t += dt
        }
        return out
    }

    /// Exact lap time for a given pace.
    static func lapTime(slowFactor: Double = 1.0) -> Double {
        let arc = 2 * Double.pi * radius
        return (arc / 18.0 + 2 * straight / 40.0) * slowFactor
    }

    static var track: Track {
        Track(
            id: "stadium", name: "Stadium", country: "XX", kind: .circuit, length: length,
            location: origin,
            startFinish: Gate(center: projection.toGeo(Vec2(0, -radius)), heading: 270, width: 30),
            sectors: [Gate(center: projection.toGeo(Vec2(0, radius)), heading: 90, width: 30)]
        )
    }
}
