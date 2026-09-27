import CoreLocation
import CoreMotion
import Foundation
import RaceCore

/// iPhone GPS at the highest rate the chip offers, with background updates while timing.
final class LocationService: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    var onLocation: ((CLLocation) -> Void)?
    var onAuthorization: ((CLAuthorizationStatus) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .otherNavigation
        manager.pausesLocationUpdatesAutomatically = false
    }

    var authorization: CLAuthorizationStatus { manager.authorizationStatus }

    func requestAuthorization() {
        manager.requestWhenInUseAuthorization()
    }

    func start() {
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = true
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for l in locations { onLocation?(l) }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        onAuthorization?(manager.authorizationStatus)
    }
}

/// 100 Hz device motion in a gravity-aligned frame with arbitrary yaw.
/// (Magnetometer-referenced frames are unreliable inside a car, see `ImuAligner`.)
final class MotionService {
    private let manager = CMMotionManager()
    private let queue = OperationQueue()
    /// (uptime timestamp, horizontal user acceleration in m/s² in the reference frame)
    var onSample: ((TimeInterval, Vec2) -> Void)?

    init() {
        queue.maxConcurrentOperationCount = 1
        queue.qualityOfService = .userInteractive
    }

    var isAvailable: Bool { manager.isDeviceMotionAvailable }

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 100
        manager.startDeviceMotionUpdates(using: .xArbitraryCorrectedZVertical, to: queue) { [weak self] m, _ in
            guard let m, let self else { return }
            // Rotate device-frame user acceleration into the reference frame: a_ref = Rᵀ · a_dev
            let r = m.attitude.rotationMatrix
            let a = m.userAcceleration
            let x = r.m11 * a.x + r.m21 * a.y + r.m31 * a.z
            let y = r.m12 * a.x + r.m22 * a.y + r.m32 * a.z
            self.onSample?(m.timestamp, Vec2(x * DerivedGForce.g, y * DerivedGForce.g))
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}
