import Foundation

/// One-axis constant-acceleration Kalman filter with acceleration as a control input.
/// State: [position, velocity]. Because the east and north axes are independent (diagonal R,
/// no cross-coupling in F/Q), two of these are exactly equivalent to the full 4-state filter
/// and far cheaper to run at 100 Hz.
struct AxisKalman {
    var p = 0.0
    var v = 0.0
    // Covariance [[a, b], [b, c]]
    var a = 100.0
    var b = 0.0
    var c = 100.0

    mutating func predict(dt: Double, accel: Double, q: Double) {
        guard dt > 0 else { return }
        p += v * dt + 0.5 * accel * dt * dt
        v += accel * dt
        let dt2 = dt * dt
        a = a + 2 * dt * b + dt2 * c + q * dt2 * dt2 / 4
        b = b + dt * c + q * dt2 * dt / 2
        c = c + q * dt2
    }

    mutating func updatePosition(_ z: Double, r: Double) {
        let s = a + r
        guard s > 0 else { return }
        let k0 = a / s, k1 = b / s
        let y = z - p
        p += k0 * y
        v += k1 * y
        let na = a - k0 * a
        let nb = b - k0 * b
        let nc = c - k1 * b
        a = na; b = nb; c = nc
    }

    mutating func updateVelocity(_ z: Double, r: Double) {
        let s = c + r
        guard s > 0 else { return }
        let k0 = b / s, k1 = c / s
        let y = z - v
        p += k0 * y
        v += k1 * y
        let na = a - k0 * b
        let nb = b - k0 * c
        let nc = c - k1 * c
        a = na; b = nb; c = nc
    }
}

/// GPS + IMU fusion producing a smooth high-rate position/velocity estimate.
///
/// - IMU (100 Hz, acceleration already rotated into the East-North frame) drives the prediction.
/// - GPS position and Doppler velocity correct it, weighted by reported accuracy.
/// This turns 1-10 Hz phone GPS into a 100 Hz trajectory so start/finish and sector crossings
/// can be interpolated with far less error, and the delta display updates smoothly.
public final class SensorFusion {
    public struct GPSFix: Sendable {
        public var t: Double
        public var position: GeoPoint
        /// m/s, negative if invalid
        public var speed: Double
        /// degrees true, negative/NaN if invalid
        public var course: Double
        public var horizontalAccuracy: Double
        public var speedAccuracy: Double
        public var altitude: Double

        public init(
            t: Double, position: GeoPoint, speed: Double, course: Double,
            horizontalAccuracy: Double, speedAccuracy: Double = 0.5, altitude: Double = 0
        ) {
            self.t = t
            self.position = position
            self.speed = speed
            self.course = course
            self.horizontalAccuracy = horizontalAccuracy
            self.speedAccuracy = speedAccuracy
            self.altitude = altitude
        }
    }

    /// Acceleration noise density (m/s²)². Covers IMU bias, vibration and unmodelled jerk.
    public var accelNoise = 1.5 * 1.5
    public private(set) var projection: LocalProjection?
    public private(set) var t: Double = 0
    private var east = AxisKalman()
    private var north = AxisKalman()
    private var lastAccel = Vec2.zero
    private var altitude = 0.0
    private var accuracy = 0.0
    private var lastFixT = -Double.infinity

    public init(origin: GeoPoint? = nil) {
        if let o = origin { projection = LocalProjection(origin: o) }
    }

    public var isInitialized: Bool { lastFixT.isFinite }

    /// Feed an IMU sample. `accelEN` is user acceleration (gravity removed) in m/s², East/North.
    /// Returns a fused sample at the IMU rate once GPS has initialised the filter.
    @discardableResult
    public func ingestIMU(t: Double, accelEN: Vec2) -> TelemetrySample? {
        guard isInitialized else { return nil }
        // Without GPS for > 2 s, IMU-only dead reckoning diverges quickly; stop emitting.
        guard t - lastFixT < 2 else { return nil }
        propagate(to: t)
        lastAccel = accelEN
        return current(source: .fused)
    }

    /// Feed a GPS fix. Returns the corrected estimate.
    @discardableResult
    public func ingestGPS(_ fix: GPSFix) -> TelemetrySample {
        if projection == nil { projection = LocalProjection(origin: fix.position) }
        let local = projection!.toLocal(fix.position)
        let hasVel = fix.speed >= 0 && fix.course.isFinite && fix.course >= 0

        if !isInitialized {
            east = AxisKalman(p: local.x, v: 0, a: 25, b: 0, c: 25)
            north = AxisKalman(p: local.y, v: 0, a: 25, b: 0, c: 25)
            if hasVel {
                let c = Geo.deg2rad(fix.course)
                east.v = fix.speed * sin(c)
                north.v = fix.speed * cos(c)
            }
            t = fix.t
        } else {
            propagate(to: max(t, fix.t))
        }

        let r = max(fix.horizontalAccuracy, 0.5)
        east.updatePosition(local.x, r: r * r)
        north.updatePosition(local.y, r: r * r)
        if hasVel {
            let c = Geo.deg2rad(fix.course)
            let rv = max(fix.speedAccuracy, 0.1)
            east.updateVelocity(fix.speed * sin(c), r: rv * rv)
            north.updateVelocity(fix.speed * cos(c), r: rv * rv)
        }
        if fix.speed >= 0, fix.speed < 0.3 {
            // Stationary: kill integrated IMU drift.
            east.v = 0
            north.v = 0
        }
        altitude = fix.altitude
        accuracy = fix.horizontalAccuracy
        lastFixT = fix.t
        return current(source: .fused)
    }

    private func propagate(to newT: Double) {
        let dt = newT - t
        guard dt > 0 else { return }
        east.predict(dt: dt, accel: lastAccel.x, q: accelNoise)
        north.predict(dt: dt, accel: lastAccel.y, q: accelNoise)
        t = newT
    }

    private func current(source: PositionSource) -> TelemetrySample {
        let vel = Vec2(east.v, north.v)
        let speed = vel.length
        let heading = speed > 1 ? Geo.normalizeDegrees(Geo.rad2deg(atan2(vel.x, vel.y))) : .nan
        var longG = 0.0, latG = 0.0
        if speed > 1 {
            let fwd = vel.normalized
            let left = Vec2(-fwd.y, fwd.x)
            longG = lastAccel.dot(fwd) / DerivedGForce.g
            latG = lastAccel.dot(left) / DerivedGForce.g
        }
        let pos = projection!.toGeo(Vec2(east.p, north.p))
        return TelemetrySample(
            t: t, position: pos, speed: speed, heading: heading, altitude: altitude,
            accuracy: accuracy, longG: longG, latG: latG, source: source
        )
    }
}
