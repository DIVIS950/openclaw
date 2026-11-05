import Foundation
import UserNotifications

/// Phone notifications: "you've been in the shop 2 minutes, show your card" and
/// reminders before coupons, cards and gift cards expire.
@MainActor
enum Notifier {
    private nonisolated static let dwellKey = "kapsa.dwellScheduledAt"
    /// Don't remind about the same card again within this time.
    private nonisolated static let repeatAfter: TimeInterval = 3 * 3600

    nonisolated static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    nonisolated static func isAllowed() async -> Bool {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
    }

    // MARK: In the shop for a few minutes

    /// Walked into a shop with a card: remind to use it after `minutes`, unless the person
    /// leaves first (`leftShop` cancels it). Once per visit, at most every 3 hours.
    nonisolated static func enteredShop(cardID: UUID, title: String, body: String, minutes: Int) async {
        let id = "dwell-\(cardID.uuidString)"
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        if pending.contains(where: { $0.identifier == id }) {
            return
        }
        var log = UserDefaults.standard.dictionary(forKey: dwellKey) as? [String: Double] ?? [:]
        if let last = log[cardID.uuidString], Date().timeIntervalSince1970 - last < repeatAfter {
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["card": cardID.uuidString]
        let delay = TimeInterval(max(1, minutes) * 60)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        do {
            try await center.add(UNNotificationRequest(identifier: id, content: content, trigger: trigger))
            log[cardID.uuidString] = Date().timeIntervalSince1970 + delay
            UserDefaults.standard.set(log, forKey: dwellKey)
        } catch {
            // Not allowed: the in-app reminder still works while Kapsa is open.
        }
    }

    /// Left the shop before the reminder fired: cancel it and allow the next visit.
    static func leftShop(cardID: UUID) {
        let id = "dwell-\(cardID.uuidString)"
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
        var log = UserDefaults.standard.dictionary(forKey: dwellKey) as? [String: Double] ?? [:]
        if let due = log[cardID.uuidString], due > Date().timeIntervalSince1970 {
            log[cardID.uuidString] = nil
            UserDefaults.standard.set(log, forKey: dwellKey)
        }
    }

    // MARK: Expiry reminders

    /// One reminder to schedule: when, what, and which card or coupon it opens.
    struct Reminder: Sendable {
        let id: String
        let date: Date
        let title: String
        let body: String
        let cardID: UUID?
    }

    /// Replace all expiry reminders (at 9:00, a few days before).
    nonisolated static func scheduleExpiry(_ reminders: [Reminder]) async {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        let old = pending.map(\.identifier).filter { $0.hasPrefix("exp-") }
        center.removePendingNotificationRequests(withIdentifiers: old)
        // iOS keeps at most 64 pending notifications; leave room for the shop reminders.
        let upcoming = reminders.filter { $0.date > Date() }.sorted { $0.date < $1.date }.prefix(48)
        for r in upcoming {
            let content = UNMutableNotificationContent()
            content.title = r.title
            content.body = r.body
            content.sound = .default
            if let cardID = r.cardID {
                content.userInfo = ["card": cardID.uuidString]
            }
            let parts = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: r.date)
            let trigger = UNCalendarNotificationTrigger(dateMatching: parts, repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "exp-\(r.id)", content: content, trigger: trigger))
        }
    }

    /// What to remind about, from the current data. Pure, so it is easy to reason about.
    static func expiryReminders(cards: [Card], coupons: [Coupon], settings: AppSettings) -> [Reminder] {
        guard settings.expiryReminders else { return [] }
        let cal = Calendar.current
        func at9(_ day: Date, before days: Int) -> Date? {
            guard let d = cal.date(byAdding: .day, value: -days, to: cal.startOfDay(for: day)) else { return nil }
            return cal.date(bySettingHour: 9, minute: 0, second: 0, of: d)
        }
        var out: [Reminder] = []
        for c in coupons where !c.used {
            guard let e = c.expiry, let when = at9(e, before: settings.remindDays) else { continue }
            let what = [c.discount, c.title].filter { !$0.isEmpty }.joined(separator: " · ")
            out.append(Reminder(id: "c-\(c.id.uuidString)", date: when, title: L("Kupón brzy končí", "Coupon ending soon"), body: what, cardID: c.cardID))
        }
        for card in cards {
            guard let e = card.expiry else { continue }
            if card.isGift {
                let left = card.balance ?? 0
                guard left > 0, let when = at9(e, before: 14) else { continue }
                out.append(Reminder(
                    id: "g-\(card.id.uuidString)", date: when,
                    title: L("Dárková karta brzy vyprší", "Gift card expiring soon"),
                    body: L("\(card.name) · zbývá \(money(left, settings.currency))", "\(card.name) · \(money(left, settings.currency)) left"),
                    cardID: card.id
                ))
            } else if let when = at9(e, before: max(settings.remindDays, 7)) {
                out.append(Reminder(id: "k-\(card.id.uuidString)", date: when, title: L("Karta brzy končí", "Card expiring soon"), body: card.name, cardID: card.id))
            }
        }
        return out
    }
}
