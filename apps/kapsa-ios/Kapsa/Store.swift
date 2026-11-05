import CoreLocation
import Foundation
import Observation
import SwiftUI

enum AppTab: Hashable {
    case wallet, coupons, stats, settings
}

struct CardRoute: Hashable {
    let id: UUID
}

struct CouponRoute: Hashable {
    let id: UUID
}

/// Sheets any screen can open.
enum AppSheet: Identifiable {
    case addCard(CardKind)
    case editCard(UUID)
    case addCoupon(UUID?)
    case editCoupon(UUID)
    case promo(UUID)
    case pay(UUID)
    case logSpend(UUID?)

    var id: String {
        switch self {
        case let .addCard(kind): "add-\(kind.rawValue)"
        case let .editCard(id): "edit-\(id)"
        case let .addCoupon(id): "newc-\(id?.uuidString ?? "")"
        case let .editCoupon(id): "ecoupon-\(id)"
        case let .promo(id): "promo-\(id)"
        case let .pay(id): "pay-\(id)"
        case let .logSpend(id): "log-\(id?.uuidString ?? "")"
        }
    }
}

/// A short message at the bottom, optionally with one action (Undo).
struct Toast: Identifiable {
    let id = UUID()
    let text: String
    var actionTitle: String?
    var action: (() -> Void)?
}

/// All of the app's data and actions. Saved as one JSON file on the phone.
@MainActor
@Observable
final class Store {
    static let shared = Store()

    private(set) var data: AppData
    /// Bumps on every change; the app re-syncs shop reminders and notifications on it.
    private(set) var revision = 0

    // Navigation (also used to open a card from a notification).
    var tab: AppTab = .wallet
    var walletPath = NavigationPath()
    var couponsPath = NavigationPath()
    var sheet: AppSheet?
    var bigCode: BigCode?
    var toast: Toast?
    /// Bump to throw confetti.
    var confetti = 0

    // Filled in by LocationService.
    var location: CLLocation?
    var locationStatus: CLAuthorizationStatus = .notDetermined

    @ObservationIgnored private var saveTask: Task<Void, Never>?

    init() {
        data = Store.load() ?? AppData()
    }

    var cards: [Card] { data.cards }
    var coupons: [Coupon] { data.coupons }
    var purchases: [Purchase] { data.purchases }
    var settings: AppSettings { data.settings }

    // MARK: Saving

    private static var fileURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return dir.appendingPathComponent("kapsa.json")
    }

    private static func load() -> AppData? {
        guard let raw = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try? decoder.decode(AppData.self, from: raw)
    }

    private static func encode(_ data: AppData) -> Data? {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        return try? encoder.encode(data)
    }

    private static func write(_ data: AppData) {
        guard let raw = encode(data) else { return }
        let url = fileURL
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? raw.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// Change the data; saves shortly after (many quick changes become one write).
    func mutate(_ change: (inout AppData) -> Void) {
        change(&data)
        revision += 1
        saveTask?.cancel()
        let snapshot = data
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            Store.write(snapshot)
        }
    }

    func saveNow() {
        saveTask?.cancel()
        Store.write(data)
    }

    // MARK: Cards

    func card(_ id: UUID) -> Card? {
        data.cards.first { $0.id == id }
    }

    func upsert(_ card: Card) {
        mutate { d in
            if let i = d.cards.firstIndex(where: { $0.id == card.id }) {
                d.cards[i] = card
            } else {
                d.cards.append(card)
            }
        }
    }

    func updateCard(_ id: UUID, _ change: (inout Card) -> Void) {
        mutate { d in
            if let i = d.cards.firstIndex(where: { $0.id == id }) {
                change(&d.cards[i])
            }
        }
    }

    func deleteCard(_ id: UUID) {
        mutate { d in
            let name = d.cards.first { $0.id == id }?.name ?? ""
            d.cards.removeAll { $0.id == id }
            // Coupons and spending stay, with the shop name; they just lose the link.
            for i in d.coupons.indices where d.coupons[i].cardID == id {
                d.coupons[i].cardID = nil
                if d.coupons[i].shop.isEmpty { d.coupons[i].shop = name }
            }
            for i in d.purchases.indices where d.purchases[i].cardID == id {
                d.purchases[i].cardID = nil
            }
        }
    }

    /// Count a card as shown at the till.
    func markUsed(_ id: UUID) {
        updateCard(id) { c in
            c.uses += 1
            c.lastUsedAt = Date()
        }
    }

    /// Add one stamp; true when the reward is now ready.
    @discardableResult
    func addStamp(_ id: UUID) -> Bool {
        var ready = false
        updateCard(id) { c in
            guard var s = c.stamps else { return }
            s.count = min(s.goal, s.count + 1)
            ready = s.isFull
            c.stamps = s
        }
        return ready
    }

    func removeStamp(_ id: UUID) {
        updateCard(id) { c in
            guard var s = c.stamps, s.count > 0 else { return }
            s.count -= 1
            c.stamps = s
        }
    }

    /// Use the reward: start a fresh stamp card.
    func redeemStamps(_ id: UUID) {
        updateCard(id) { c in
            guard var s = c.stamps else { return }
            s.count = 0
            s.redeemed += 1
            c.stamps = s
        }
    }

    func addPlace(_ id: UUID, _ place: Place) {
        updateCard(id) { $0.places.append(place) }
    }

    func removePlace(_ id: UUID, _ placeID: UUID) {
        updateCard(id) { $0.places.removeAll { $0.id == placeID } }
    }

    // MARK: Gift cards

    /// Pay with a gift card: the balance goes down and it counts as spending.
    @discardableResult
    func pay(_ cardID: UUID, amount: Double) -> Purchase? {
        guard let card = self.card(cardID), card.isGift, amount > 0 else { return nil }
        let purchase = Purchase(cardID: cardID, shop: card.name, amount: (amount * 100).rounded() / 100, source: .gift)
        mutate { d in
            if let i = d.cards.firstIndex(where: { $0.id == cardID }) {
                let left = (d.cards[i].balance ?? 0) - amount
                d.cards[i].balance = max(0, (left * 100).rounded() / 100)
            }
            d.purchases.append(purchase)
        }
        return purchase
    }

    /// Take a gift card payment back (the "Undo" after paying).
    func undoPayment(_ purchaseID: UUID) {
        mutate { d in
            guard let p = d.purchases.first(where: { $0.id == purchaseID }) else { return }
            if p.source == .gift, let id = p.cardID, let i = d.cards.firstIndex(where: { $0.id == id }) {
                d.cards[i].balance = ((d.cards[i].balance ?? 0) + p.amount * 100).rounded() / 100
            }
            d.purchases.removeAll { $0.id == purchaseID }
        }
    }

    func setBalance(_ cardID: UUID, _ value: Double) {
        updateCard(cardID) { c in
            c.balance = max(0, value)
            c.initialBalance = max(c.initialBalance ?? 0, value)
        }
    }

    // MARK: Coupons

    func coupon(_ id: UUID) -> Coupon? {
        data.coupons.first { $0.id == id }
    }

    func saveCoupon(_ coupon: Coupon) {
        mutate { d in
            if let i = d.coupons.firstIndex(where: { $0.id == coupon.id }) {
                d.coupons[i] = coupon
            } else {
                d.coupons.append(coupon)
            }
        }
    }

    func deleteCoupon(_ id: UUID) {
        mutate { $0.coupons.removeAll { $0.id == id } }
    }

    /// Mark a coupon used; the saving (if given) counts in the stats.
    func useCoupon(_ id: UUID, saved: Double?) {
        mutate { d in
            if let i = d.coupons.firstIndex(where: { $0.id == id }) {
                d.coupons[i].used = true
                d.coupons[i].usedAt = Date()
                d.coupons[i].saved = saved
            }
        }
    }

    func isActive(_ c: Coupon) -> Bool {
        guard !c.used else { return false }
        guard let e = c.expiry else { return true }
        return e.daysFromToday >= 0
    }

    /// Coupons and promo codes of a card that can still be used, soonest ending first.
    func activeCoupons(for card: Card) -> [Coupon] {
        let name = card.name.lowercased()
        return data.coupons
            .filter { isActive($0) && ($0.cardID == card.id || ($0.cardID == nil && !$0.shop.isEmpty && $0.shop.lowercased() == name)) }
            .sorted { ($0.expiry ?? .distantFuture) < ($1.expiry ?? .distantFuture) }
    }

    func shopName(of coupon: Coupon) -> String {
        if let id = coupon.cardID, let c = card(id) { return c.name }
        return coupon.shop
    }

    // MARK: Spending

    func logPurchase(_ purchase: Purchase) {
        mutate { $0.purchases.append(purchase) }
    }

    func deletePurchase(_ id: UUID) {
        mutate { $0.purchases.removeAll { $0.id == id } }
    }

    func purchases(inMonthOf date: Date) -> [Purchase] {
        let cal = Calendar.current
        return data.purchases
            .filter { cal.isDate($0.date, equalTo: date, toGranularity: .month) }
            .sorted { $0.date > $1.date }
    }

    /// Saved this month: from purchases and from coupons used this month.
    func saved(inMonthOf date: Date) -> Double {
        let cal = Calendar.current
        let fromPurchases = purchases(inMonthOf: date).reduce(0) { $0 + $1.saved }
        let fromCoupons = data.coupons
            .filter { $0.used && $0.usedAt.map { cal.isDate($0, equalTo: date, toGranularity: .month) } == true }
            .reduce(0) { $0 + ($1.saved ?? 0) }
        return fromPurchases + fromCoupons
    }

    // MARK: Settings

    func updateSettings(_ change: (inout AppSettings) -> Void) {
        mutate { change(&$0.settings) }
    }

    // MARK: Where am I

    /// Metres from here to the card's nearest saved place (nil without location or places).
    func distance(to card: Card) -> Double? {
        guard let here = location, !card.places.isEmpty else { return nil }
        return card.places
            .map { CLLocation(latitude: $0.latitude, longitude: $0.longitude).distance(from: here) }
            .min()
    }

    /// The card of the shop you're standing in, if any.
    var hereCard: (card: Card, distance: Double)? {
        let radius = max(settings.radius, 40)
        return data.cards
            .compactMap { c in distance(to: c).map { (card: c, distance: $0) } }
            .filter { $0.distance <= radius }
            .min { $0.distance < $1.distance }
    }

    /// Wallet order: the shop you're in, then nearest, then most used.
    func walletOrder() -> [Card] {
        let here = hereCard?.card.id
        return data.cards.sorted { a, b in
            if a.id == here { return true }
            if b.id == here { return false }
            switch (distance(to: a), distance(to: b)) {
            case let (x?, y?) where abs(x - y) > 50: return x < y
            case (.some, nil): return true
            case (nil, .some): return false
            default: return (a.lastUsedAt ?? a.createdAt) > (b.lastUsedAt ?? b.createdAt)
            }
        }
    }

    // MARK: Opening from notifications

    func open(cardID: UUID) {
        tab = .wallet
        sheet = nil
        var path = NavigationPath()
        if card(cardID) != nil {
            path.append(CardRoute(id: cardID))
        }
        walletPath = path
    }

    func show(_ text: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        toast = Toast(text: text, actionTitle: actionTitle, action: action)
    }

    // MARK: Backup

    /// A backup file to share (AirDrop, Files, mail).
    func exportFile() -> URL? {
        guard let raw = Store.encode(data) else { return nil }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("kapsa-backup.json")
        do {
            try raw.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    /// Load a backup; items with the same id are replaced, others added. Returns how many.
    func importFile(_ url: URL) -> Int? {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        guard let raw = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let incoming = try? decoder.decode(AppData.self, from: raw) else { return nil }
        mutate { d in
            for c in incoming.cards {
                d.cards.removeAll { $0.id == c.id }
                d.cards.append(c)
            }
            for c in incoming.coupons {
                d.coupons.removeAll { $0.id == c.id }
                d.coupons.append(c)
            }
            for p in incoming.purchases {
                d.purchases.removeAll { $0.id == p.id }
                d.purchases.append(p)
            }
        }
        return incoming.cards.count + incoming.coupons.count + incoming.purchases.count
    }

    var hasSamples: Bool {
        data.cards.contains { $0.sample } || data.coupons.contains { $0.sample } || data.purchases.contains { $0.sample }
    }

    func removeSamples() {
        mutate { d in
            d.cards.removeAll { $0.sample }
            d.coupons.removeAll { $0.sample }
            d.purchases.removeAll { $0.sample }
        }
    }

    func wipe() {
        walletPath = NavigationPath()
        couponsPath = NavigationPath()
        mutate { $0 = AppData() }
    }
}
