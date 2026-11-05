import Foundation

// MARK: - Barcode formats

/// The kinds of codes a card or coupon can carry.
enum BarcodeFormat: String, Codable, CaseIterable, Identifiable, Sendable {
    case ean13, ean8, upca, code128, code39, qr, pdf417, aztec, none

    var id: String { rawValue }

    var label: String {
        switch self {
        case .ean13: "EAN-13"
        case .ean8: "EAN-8"
        case .upca: "UPC-A"
        case .code128: "Code 128"
        case .code39: "Code 39"
        case .qr: "QR"
        case .pdf417: "PDF417"
        case .aztec: "Aztec"
        case .none: L("Bez kódu", "No code")
        }
    }

    /// Linear codes are drawn wide and short; 2D codes square.
    var isLinear: Bool {
        switch self {
        case .qr, .aztec, .none: false
        default: true
        }
    }
}

// MARK: - Categories

enum ShopCategory: String, Codable, CaseIterable, Identifiable, Sendable {
    case bakery, grocery, coffee, food, pharmacy, beauty, fashion, sport, fuel, home, electronics, other

    var id: String { rawValue }

    /// SF Symbol for the category.
    var symbol: String {
        switch self {
        case .bakery: "birthday.cake"
        case .grocery: "basket"
        case .coffee: "cup.and.saucer"
        case .food: "fork.knife"
        case .pharmacy: "cross.case"
        case .beauty: "sparkles"
        case .fashion: "tshirt"
        case .sport: "figure.run"
        case .fuel: "fuelpump"
        case .home: "hammer"
        case .electronics: "bolt"
        case .other: "tag"
        }
    }

    var name: String {
        switch self {
        case .bakery: L("Pekárna", "Bakery")
        case .grocery: L("Potraviny", "Groceries")
        case .coffee: L("Kavárna", "Coffee")
        case .food: L("Jídlo", "Food")
        case .pharmacy: L("Lékárna", "Pharmacy")
        case .beauty: L("Drogerie", "Beauty")
        case .fashion: L("Oblečení", "Fashion")
        case .sport: L("Sport", "Sport")
        case .fuel: L("Benzínka", "Fuel")
        case .home: L("Dům a hobby", "Home")
        case .electronics: L("Elektronika", "Electronics")
        case .other: L("Ostatní", "Other")
        }
    }
}

enum CardKind: String, Codable, Sendable {
    case loyalty, gift
}

// MARK: - Data

/// A saved spot where a card should pop up (a shop branch).
struct Place: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    var latitude: Double
    var longitude: Double
    var label: String = ""
    var savedAt = Date()
}

/// `goal` stamps earn `reward`; `count` is collected now, `redeemed` rewards used so far.
struct Stamps: Codable, Hashable, Sendable {
    var goal: Int
    var count: Int = 0
    var reward: String = ""
    var redeemed: Int = 0

    var isFull: Bool { count >= goal }
}

struct Card: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    var name: String
    var code: String = ""
    var format: BarcodeFormat = .code128
    var colorHex: String = "#FF6B6B"
    var category: ShopCategory = .other
    var kind: CardKind = .loyalty
    var places: [Place] = []
    var note: String = ""
    var points: Int?
    var pointsGoal: Int?
    var stamps: Stamps?
    var expiry: Date?
    /// Gift cards: money left and the starting value.
    var balance: Double?
    var initialBalance: Double?
    var pin: String = ""
    /// Shop website ("albert.cz"), used for the logo.
    var website: String = ""
    /// The person's own logo picture (small PNG/JPEG).
    var logoData: Data?
    var createdAt = Date()
    var lastUsedAt: Date?
    var uses: Int = 0
    var sample: Bool = false

    var isGift: Bool { kind == .gift }
}

struct Coupon: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    var title: String
    var discount: String = ""
    var cardID: UUID?
    var shop: String = ""
    var code: String = ""
    var format: BarcodeFormat = .none
    var expiry: Date?
    var note: String = ""
    var used: Bool = false
    var usedAt: Date?
    var saved: Double?
    var createdAt = Date()
    var sample: Bool = false
}

enum PurchaseSource: String, Codable, Sendable {
    case manual, gift
}

struct Purchase: Codable, Identifiable, Hashable, Sendable {
    var id = UUID()
    var cardID: UUID?
    var shop: String
    var amount: Double
    var saved: Double = 0
    var date = Date()
    var source: PurchaseSource = .manual
    var sample: Bool = false
}

struct AppSettings: Codable, Hashable, Sendable {
    /// How close to a saved place counts as "in the shop" (metres).
    var radius: Double = 120
    /// "You've been here N minutes: show your card."
    var dwellOn: Bool = true
    var dwellMinutes: Int = 2
    var expiryReminders: Bool = true
    var remindDays: Int = 3
    var logos: Bool = true
    var currency: String = "CZK"
    var followSystemDarkMode: Bool = false
}

/// Everything the app saves, in one JSON file.
struct AppData: Codable, Sendable {
    var cards: [Card] = []
    var coupons: [Coupon] = []
    var purchases: [Purchase] = []
    var settings = AppSettings()
}

// MARK: - Helpers

extension Date {
    /// Whole days from today until this date (0 = today, negative = past).
    var daysFromToday: Int {
        let cal = Calendar.current
        return cal.dateComponents([.day], from: cal.startOfDay(for: Date()), to: cal.startOfDay(for: self)).day ?? 0
    }
}

/// "1 500 Kč" in the chosen currency.
func money(_ amount: Double, _ currency: String) -> String {
    amount.formatted(.currency(code: currency).precision(.fractionLength(0...2)))
}

/// "120 m" or "1,4 km".
func distanceText(_ meters: Double) -> String {
    if meters < 1000 {
        return "\(Int((meters / 10).rounded() * 10)) m"
    }
    let km = (meters / 100).rounded() / 10
    return "\(km.formatted(.number.precision(.fractionLength(0...1)))) km"
}

/// Parse "1 234,50", "1,234.50" or "89 Kč" into a number.
func parseMoney(_ text: String) -> Double? {
    var s = text.filter { "0123456789,.-".contains($0) }
    guard s.contains(where: \.isNumber) else { return nil }
    if s.contains(","), !s.contains(".") || (s.lastIndex(of: ",")! > s.lastIndex(of: ".")!) {
        s = s.replacingOccurrences(of: ".", with: "").replacingOccurrences(of: ",", with: ".")
    } else {
        s = s.replacingOccurrences(of: ",", with: "")
    }
    guard let value = Double(s), value.isFinite, abs(value) < 1e8 else { return nil }
    return (value * 100).rounded() / 100
}

/// A website typed by a person ("https://www.Albert.cz/akce") as a bare domain ("albert.cz").
func cleanDomain(_ value: String) -> String {
    var host = value.trimmingCharacters(in: .whitespaces).lowercased()
    if let range = host.range(of: "://") {
        host = String(host[range.upperBound...])
    }
    if let cut = host.firstIndex(where: { "/?#:".contains($0) }) {
        host = String(host[..<cut])
    }
    if host.hasPrefix("www.") {
        host.removeFirst(4)
    }
    let ok = host.count <= 100 && host.contains(".")
        && host.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }
        && !host.hasPrefix(".") && !host.hasSuffix(".")
    return ok ? host : ""
}
