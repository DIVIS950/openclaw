import CoreLocation
import Foundation
import UIKit

/// Where the phone is, and the shop reminders that work even when Kapsa is closed:
/// iOS watches up to 20 saved shop places ("regions") and wakes the app when you walk
/// in or out. Walking in starts the "show your card" reminder; walking out cancels it.
@MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    private let manager = CLLocationManager()
    private var lastSyncLocation: CLLocation?
    private var hereCardID: UUID?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 10
        Store.shared.locationStatus = manager.authorizationStatus
    }

    var canUseLocation: Bool {
        let s = manager.authorizationStatus
        return s == .authorizedWhenInUse || s == .authorizedAlways
    }

    func requestWhenInUse() {
        manager.requestWhenInUseAuthorization()
    }

    /// Needed for shop reminders while the app is closed.
    func requestAlways() {
        manager.requestAlwaysAuthorization()
    }

    /// Live updates while the app is on screen.
    func startUpdating() {
        if canUseLocation {
            manager.startUpdatingLocation()
        }
    }

    func stopUpdating() {
        manager.stopUpdatingLocation()
    }

    // MARK: Shop regions

    /// Watch the saved places nearest to you (iOS allows 20 at a time).
    func syncRegions() {
        let store = Store.shared
        for region in manager.monitoredRegions where region.identifier.hasPrefix("kapsa|") {
            manager.stopMonitoring(for: region)
        }
        guard manager.authorizationStatus == .authorizedAlways,
              store.settings.dwellOn,
              CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self)
        else { return }
        let here = store.location
        var spots: [(id: String, center: CLLocationCoordinate2D, distance: Double)] = []
        for card in store.cards {
            for place in card.places {
                let center = CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
                let d = here?.distance(from: CLLocation(latitude: place.latitude, longitude: place.longitude)) ?? 0
                spots.append((id: "kapsa|\(card.id.uuidString)|\(place.id.uuidString)", center: center, distance: d))
            }
        }
        spots.sort { $0.distance < $1.distance }
        // iOS needs about 100 m to notice entering a region reliably.
        let radius = min(max(store.settings.radius, 100), manager.maximumRegionMonitoringDistance)
        for spot in spots.prefix(20) {
            let region = CLCircularRegion(center: spot.center, radius: radius, identifier: spot.id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
        }
        lastSyncLocation = here
    }

    // MARK: Here (app open)

    /// Called after every location change: the in-app "you're here" and its reminder.
    private func updateHere() {
        let store = Store.shared
        let now = store.hereCard?.card.id
        if now != hereCardID {
            if let old = hereCardID {
                Notifier.leftShop(cardID: old)
            }
            hereCardID = now
            if let now {
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                enteredShop(cardID: now)
            }
        }
        // Moved far: watch the places around the new spot instead.
        if let loc = store.location, lastSyncLocation.map({ $0.distance(from: loc) > 2000 }) ?? true {
            syncRegions()
        }
    }

    /// Start the "show your card" reminder for a card's shop.
    func enteredShop(cardID: UUID) {
        let store = Store.shared
        guard store.settings.dwellOn, let card = store.card(cardID) else { return }
        let coupons = store.activeCoupons(for: card).count
        var extras: [String] = []
        if card.isGift {
            extras.append(L("Zbývá \(money(card.balance ?? 0, store.settings.currency))", "\(money(card.balance ?? 0, store.settings.currency)) left"))
        }
        if coupons > 0 {
            extras.append(L("\(coupons) kupón(y)", "\(coupons) coupon(s)"))
        }
        if let s = card.stamps {
            extras.append(L("razítka \(s.count)/\(s.goal)", "stamps \(s.count)/\(s.goal)"))
        }
        let title = L("Jsi v \(card.name): ukaž kartu", "At \(card.name): show your card")
        let body = ([L("Ať ti nic neuteče.", "Don't miss out.")] + extras).joined(separator: " ")
        let minutes = store.settings.dwellMinutes
        Task {
            await Notifier.enteredShop(cardID: cardID, title: title, body: body, minutes: minutes)
        }
    }

    // MARK: CLLocationManagerDelegate (iOS calls these off the main actor)

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            Store.shared.locationStatus = status
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                self.startUpdating()
            }
            self.syncRegions()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let last = locations.last, last.horizontalAccuracy >= 0, last.horizontalAccuracy < 500 else { return }
        let lat = last.coordinate.latitude
        let lon = last.coordinate.longitude
        let accuracy = last.horizontalAccuracy
        Task { @MainActor in
            let next = CLLocation(
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon),
                altitude: 0, horizontalAccuracy: accuracy, verticalAccuracy: -1, timestamp: Date()
            )
            let store = Store.shared
            // Ignore tiny GPS wobble so the screen doesn't jump.
            if let old = store.location, old.distance(from: next) < 8, abs(old.horizontalAccuracy - accuracy) < 15 {
                return
            }
            store.location = next
            self.updateHere()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // Temporary GPS trouble: keep the last known position.
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let id = region.identifier
        Task { @MainActor in
            if let cardID = LocationService.cardID(from: id) {
                self.enteredShop(cardID: cardID)
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        let id = region.identifier
        Task { @MainActor in
            if let cardID = LocationService.cardID(from: id), cardID != self.hereCardID {
                Notifier.leftShop(cardID: cardID)
            }
        }
    }

    /// "kapsa|<card>|<place>" -> card id.
    static func cardID(from identifier: String) -> UUID? {
        let parts = identifier.split(separator: "|")
        guard parts.count == 3, parts[0] == "kapsa" else { return nil }
        return UUID(uuidString: String(parts[1]))
    }
}
