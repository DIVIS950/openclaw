import CoreLocation
import Foundation

/// Sample cards so the app can be tried before scanning anything real. Everything is
/// marked `sample` and can be removed in Settings.
extension Store {
    func addDemo() {
        let base = location?.coordinate ?? CLLocationCoordinate2D(latitude: 50.08804, longitude: 14.42076)
        func place(_ north: Double, _ east: Double) -> [Place] {
            let lat = base.latitude + north / 111_320
            let lon = base.longitude + east / (111_320 * cos(base.latitude * .pi / 180))
            return [Place(latitude: lat, longitude: lon)]
        }
        func ean(_ body: String) -> String { body + String(Barcodes.checkDigit(body)) }
        let day: TimeInterval = 86_400
        let now = Date()

        let bb = Card(
            name: "Bageterie Boulevard", code: ean("299004718263"), format: .ean13, colorHex: "#1E1E1E",
            category: .bakery, places: place(6, -4),
            stamps: Stamps(goal: 8, count: 5, reward: L("Bageta zdarma", "Free baguette"), redeemed: 1),
            uses: 5, sample: true
        )
        let albert = Card(
            name: "Albert", code: ean("859400127734"), format: .ean13, colorHex: "#003C8F",
            category: .grocery, places: place(240, 180), points: 380, pointsGoal: 500, sample: true
        )
        let dm = Card(
            name: "dm", code: "PB-3089-4410-7752", format: .qr, colorHex: "#FFD23F",
            category: .beauty, places: place(-620, 410), points: 1240, expiry: now.addingTimeInterval(12 * day), sample: true
        )
        let costa = Card(
            name: "Costa Coffee", code: "6061012345678901", format: .code128, colorHex: "#6D1F37",
            category: .coffee, places: place(900, -1200),
            stamps: Stamps(goal: 10, count: 9, reward: L("Káva zdarma", "Free coffee")), sample: true
        )
        let ikea = Card(
            name: "IKEA", code: "6033004512348812", format: .code128, colorHex: "#0058A3",
            category: .home, kind: .gift, places: place(-1400, 900), expiry: now.addingTimeInterval(120 * day),
            balance: 1500, initialBalance: 2000, pin: "4821", sample: true
        )
        let coupons = [
            Coupon(title: L("Celý nákup", "Whole shop"), discount: "−20 %", cardID: dm.id, code: "DM20NOV", format: .qr,
                   expiry: now.addingTimeInterval(2 * day), note: L("Nad 300 Kč", "Over 300 CZK"), sample: true),
            Coupon(title: L("Promo kód", "Promo code"), discount: "−15 %", cardID: albert.id, code: "ALBERT15", format: .code128,
                   expiry: now.addingTimeInterval(20 * day), sample: true),
            Coupon(title: L("Druhá bageta", "Second baguette"), discount: "1+1", cardID: bb.id, sample: true),
        ]
        var purchases: [Purchase] = [
            Purchase(cardID: ikea.id, shop: "IKEA", amount: 500, date: now.addingTimeInterval(-20 * day), source: .gift, sample: true),
        ]
        // Six months of spending, so the stats screen has something to show.
        let cal = Calendar.current
        let spend: [(Card, [Double])] = [(albert, [412, 238, 690, 155]), (bb, [139, 129, 149]), (dm, [324, 189]), (costa, [89, 95])]
        for m in 0..<6 {
            guard let month = cal.date(byAdding: .month, value: -m, to: now) else { continue }
            for (card, amounts) in spend {
                for (i, amount) in amounts.enumerated() {
                    var parts = cal.dateComponents([.year, .month], from: month)
                    parts.day = min(27, 2 + i * 6 + (m * 3) % 5)
                    parts.hour = 12
                    guard let date = cal.date(from: parts), date <= now else { continue }
                    let factor = 0.8 + Double((m + i) % 4) * 0.12
                    purchases.append(Purchase(cardID: card.id, shop: card.name, amount: (amount * factor).rounded(),
                                              saved: i == 0 ? 15 : 0, date: date, sample: true))
                }
            }
        }
        mutate { d in
            d.cards += [bb, albert, dm, costa, ikea]
            d.coupons += coupons
            d.purchases += purchases
        }
    }
}
