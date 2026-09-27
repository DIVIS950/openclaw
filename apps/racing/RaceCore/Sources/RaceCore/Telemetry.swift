import Foundation

/// Where a position fix came from. Used to pick timing precision and to show GPS quality.
public enum PositionSource: String, Codable, Sendable {
    case phone          // CoreLocation, ~1 Hz (up to 10 Hz on newer iPhones)
    case fused          // Kalman output (GPS + IMU), 50-100 Hz
    case raceBox        // RaceBox Mini/Mini S/Micro, 25 Hz BLE
    case nmea           // Generic Bluetooth NMEA receiver (XGPS160, Garmin GLO, ...)
    case goPro          // GPMF GPS5 from GoPro video
    case imported       // CSV / GPX import or sim telemetry
}

/// One telemetry frame. Time is seconds since session start (monotonic), wall clock kept separately.
public struct TelemetrySample: Codable, Hashable, Sendable {
    public var t: Double
    public var position: GeoPoint
    /// m/s
    public var speed: Double
    /// degrees from true north, NaN if unknown
    public var heading: Double
    public var altitude: Double
    /// horizontal accuracy in meters (1-sigma), 0 when unknown
    public var accuracy: Double
    /// longitudinal / lateral acceleration in g (+ = accelerating / turning left)
    public var longG: Double
    public var latG: Double
    public var source: PositionSource

    public init(
        t: Double,
        position: GeoPoint,
        speed: Double,
        heading: Double = .nan,
        altitude: Double = 0,
        accuracy: Double = 0,
        longG: Double = 0,
        latG: Double = 0,
        source: PositionSource = .phone
    ) {
        self.t = t
        self.position = position
        self.speed = speed
        self.heading = heading
        self.altitude = altitude
        self.accuracy = accuracy
        self.longG = longG
        self.latG = latG
        self.source = source
    }

    public var speedKmh: Double { speed * 3.6 }

    /// Linear interpolation between two samples (heading uses shortest arc).
    public static func lerp(_ a: TelemetrySample, _ b: TelemetrySample, _ f: Double) -> TelemetrySample {
        func mix(_ x: Double, _ y: Double) -> Double { x + (y - x) * f }
        var h = a.heading
        if !a.heading.isNaN, !b.heading.isNaN {
            h = Geo.normalizeDegrees(a.heading + Geo.angleDiff(a.heading, b.heading) * f)
        }
        return TelemetrySample(
            t: mix(a.t, b.t),
            position: GeoPoint(lat: mix(a.position.lat, b.position.lat), lon: mix(a.position.lon, b.position.lon)),
            speed: mix(a.speed, b.speed),
            heading: h,
            altitude: mix(a.altitude, b.altitude),
            accuracy: max(a.accuracy, b.accuracy),
            longG: mix(a.longG, b.longG),
            latG: mix(a.latG, b.latG),
            source: a.source
        )
    }
}

/// Derives longitudinal/lateral G from consecutive GPS speed+heading when no IMU is available.
public enum DerivedGForce {
    public static let g = 9.80665

    public static func fill(_ samples: inout [TelemetrySample]) {
        guard samples.count > 2 else { return }
        for i in 1..<(samples.count - 1) {
            let a = samples[i - 1], b = samples[i + 1]
            let dt = b.t - a.t
            guard dt > 0.001 else { continue }
            let long = (b.speed - a.speed) / dt / g
            var lat = 0.0
            if !a.heading.isNaN, !b.heading.isNaN {
                // a_lat = v * yaw-rate. Positive yaw-rate (clockwise, right turn) -> negative latG (left positive).
                let yawRate = Geo.deg2rad(Geo.angleDiff(a.heading, b.heading)) / dt
                lat = -samples[i].speed * yawRate / g
            }
            samples[i].longG = long
            samples[i].latG = lat
        }
    }
}
