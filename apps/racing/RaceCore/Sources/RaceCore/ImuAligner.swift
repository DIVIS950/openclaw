import Foundation

/// Learns the rotation between the phone's gyro-stabilised horizontal frame and East/North.
///
/// Why: a magnetometer is useless inside a car or next to a kart engine, so CoreMotion runs in
/// `xArbitraryCorrectedZVertical` (gravity-aligned, arbitrary yaw). We then solve for the yaw
/// rotation θ that best maps IMU horizontal acceleration onto GPS-derived acceleration
/// (a 2D Procrustes fit, accumulated with exponential forgetting). Works with the phone mounted
/// at any angle, and re-converges if the mount is bumped.
public final class ImuAligner {
    private var sumDot = 0.0
    private var sumCross = 0.0
    private var weight = 0.0
    private var imuSum = Vec2.zero
    private var imuCount = 0
    private var lastVel: (t: Double, v: Vec2)?
    /// Forgetting factor per GPS epoch.
    public var decay = 0.995
    /// Minimum accumulated (m/s²)² before the estimate is trusted.
    public var minWeight = 30.0

    public init() {}

    /// Rotation angle (rad) from IMU frame to East/North, nil until confident.
    public var theta: Double? {
        weight >= minWeight ? atan2(sumCross, sumDot) : nil
    }

    /// Quality 0...1 (resultant length of the rotation estimate).
    public var confidence: Double {
        weight > 0 ? min(1, (sumDot * sumDot + sumCross * sumCross).squareRoot() / weight) : 0
    }

    /// Horizontal user acceleration (m/s²) in the IMU frame, called at IMU rate.
    public func addIMU(_ a: Vec2) {
        imuSum = imuSum + a
        imuCount += 1
    }

    /// GPS velocity (m/s, East/North) at time t.
    public func addGPSVelocity(t: Double, velocity v: Vec2) {
        defer {
            lastVel = (t, v)
            imuSum = .zero
            imuCount = 0
        }
        guard let last = lastVel, imuCount > 0 else { return }
        let dt = t - last.t
        guard dt > 0.05, dt < 1.5 else { return }
        let gpsA = (v - last.v) * (1 / dt)
        let imuA = imuSum * (1 / Double(imuCount))
        // Only informative when both see a real manoeuvre (> ~0.15 g).
        guard gpsA.length > 1.5, imuA.length > 1.5 else { return }
        sumDot = sumDot * decay + imuA.dot(gpsA)
        sumCross = sumCross * decay + imuA.cross(gpsA)
        weight = weight * decay + imuA.length * gpsA.length
    }

    /// Rotate an IMU-frame horizontal vector into East/North.
    public func toEN(_ a: Vec2) -> Vec2? {
        guard let th = theta else { return nil }
        let c = cos(th), s = sin(th)
        return Vec2(a.x * c - a.y * s, a.x * s + a.y * c)
    }
}
