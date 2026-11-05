import CoreLocation
import MapKit
import SwiftUI
import UIKit

/// Everything about one card: the code first (ready for the till), then gift card money,
/// promo codes, stamps, points, this month's spending and the places it pops up at.
struct CardDetailView: View {
    let cardID: UUID
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDelete = false

    var body: some View {
        if let card = store.card(cardID) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header(card)
                    if card.isGift {
                        GiftSection(card: card)
                    }
                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            SectionTitle(title: L("Kupóny a promo kódy", "Coupons and promo codes"), count: store.activeCoupons(for: card).count)
                            Button {
                                store.sheet = .addCoupon(card.id)
                            } label: {
                                Label(L("Kupón", "Coupon"), systemImage: "plus")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(Theme.accent)
                            }
                        }
                        PromoListView(card: card)
                    }
                    if card.stamps != nil {
                        StampsSection(card: card)
                    }
                    if !card.isGift {
                        PointsSection(card: card)
                    }
                    SpendingSection(card: card)
                    PlacesSection(card: card)
                    more(card)
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(card.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L("Upravit", "Edit")) {
                        store.sheet = .editCard(card.id)
                    }
                }
            }
            .onAppear {
                store.markUsed(card.id)
                UIApplication.shared.isIdleTimerDisabled = true
            }
            .onDisappear {
                UIApplication.shared.isIdleTimerDisabled = false
            }
        } else {
            ContentUnavailableView(L("Karta už není", "Card not found"), systemImage: "creditcard")
        }
    }

    // MARK: The card itself

    private func header(_ card: Card) -> some View {
        let look = card.look
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(chipText(card), systemImage: chipSymbol(card))
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(Color.white.opacity(0.26), in: Capsule())
                    Text(card.name)
                        .font(.system(size: 28, weight: .bold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.7)
                    if card.isGift {
                        Text(L("Zbývá \(money(card.balance ?? 0, store.settings.currency))", "\(money(card.balance ?? 0, store.settings.currency)) left"))
                            .font(.subheadline.weight(.semibold))
                            .opacity(0.92)
                    }
                }
                Spacer(minLength: 8)
                LogoView(card: card, size: 54)
            }
            if let firstLine = card.note.split(separator: "\n").first {
                Text(String(firstLine)).font(.footnote.weight(.semibold)).opacity(0.9)
            }
            CodePanel(code: card.code, format: card.format) {
                store.bigCode = BigCode(code: card.code, format: card.format, name: card.name)
            }
            Label(L("Klepni na kód a zvětší se", "Tap the code to make it big"), systemImage: "arrow.up.left.and.arrow.down.right")
                .font(.footnote.weight(.semibold))
                .opacity(0.9)
        }
        .padding(18)
        .foregroundStyle(look.ink)
        .background(CardBackground(look: look))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: look.shadow, radius: 16, y: 10)
    }

    private func chipText(_ card: Card) -> String {
        if let here = store.hereCard, here.card.id == card.id {
            return L("Jsi tady", "You're here")
        }
        if let d = store.distance(to: card) {
            return distanceText(d)
        }
        return card.isGift ? L("Dárková karta", "Gift card") : card.category.name
    }

    private func chipSymbol(_ card: Card) -> String {
        store.distance(to: card) != nil ? "location.fill" : (card.isGift ? "gift" : card.category.symbol)
    }

    // MARK: More

    private func more(_ card: Card) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: L("Více", "More"))
            Panel {
                if let expiry = card.expiry {
                    HStack {
                        Text(L("Platí do", "Valid until")).foregroundStyle(Theme.ink2)
                        Spacer()
                        Text(expiry.formatted(date: .abbreviated, time: .omitted))
                            .fontWeight(.semibold)
                            .foregroundStyle(expiry.daysFromToday < 0 ? Color.red : expiry.daysFromToday <= 30 ? Theme.warn : Theme.ink)
                    }
                }
                if !card.note.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(L("Poznámka", "Note")).font(.footnote).foregroundStyle(Theme.ink2)
                        Text(card.note).foregroundStyle(Theme.ink)
                    }
                }
                HStack {
                    Text(L("Použito", "Used")).foregroundStyle(Theme.ink2)
                    Spacer()
                    Text(L("\(card.uses)×", "\(card.uses)×")).fontWeight(.semibold).foregroundStyle(Theme.ink)
                }
                if !card.code.isEmpty {
                    ShareLink(item: "\(card.name): \(card.code)") {
                        Label(L("Poslat číslo karty", "Share card number"), systemImage: "square.and.arrow.up")
                    }
                    .foregroundStyle(Theme.accent)
                }
            }
            Button(role: .destructive) {
                confirmDelete = true
            } label: {
                Label(L("Smazat kartu", "Delete card"), systemImage: "trash")
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .confirmationDialog(L("Opravdu smazat kartu?", "Delete this card?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Smazat", "Delete"), role: .destructive) {
                    dismiss()
                    store.deleteCard(card.id)
                }
            }
        }
    }
}

// MARK: - Gift card

struct GiftSection: View {
    let card: Card
    @Environment(Store.self) private var store

    var body: some View {
        let balance = card.balance ?? 0
        let initial = max(card.initialBalance ?? 0, balance)
        let payments = store.purchases
            .filter { $0.cardID == card.id && $0.source == .gift }
            .sorted { $0.date > $1.date }
            .prefix(5)
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: L("Peníze na kartě", "Money on the card"))
            Panel {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(money(balance, store.settings.currency))
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    if initial > 0 {
                        Text(L("z \(money(initial, store.settings.currency))", "of \(money(initial, store.settings.currency))"))
                            .foregroundStyle(Theme.ink2)
                    }
                }
                if initial > 0 {
                    ProgressView(value: balance, total: initial)
                        .tint(Theme.accent)
                }
                Button {
                    store.sheet = .pay(card.id)
                } label: {
                    Label(L("Zaplatit kartou", "Pay with card"), systemImage: "wallet.pass")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(balance <= 0)
                if !card.pin.isEmpty {
                    PinRow(pin: card.pin)
                        .foregroundStyle(Theme.ink)
                }
                if !payments.isEmpty {
                    Text(L("Poslední platby", "Recent payments")).font(.footnote).foregroundStyle(Theme.ink2)
                    ForEach(Array(payments)) { p in
                        HStack {
                            Text(p.date.formatted(date: .abbreviated, time: .omitted)).foregroundStyle(Theme.ink2)
                            Spacer()
                            Text("−\(money(p.amount, store.settings.currency))").fontWeight(.semibold).foregroundStyle(Theme.ink)
                        }
                        .font(.subheadline)
                    }
                }
            }
        }
    }
}

// MARK: - Stamps

struct StampsSection: View {
    let card: Card
    @Environment(Store.self) private var store
    @State private var tick = 0

    var body: some View {
        let stamps = card.stamps ?? Stamps(goal: 10)
        let look = card.look
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: L("Razítka \(stamps.count)/\(stamps.goal)", "Stamps \(stamps.count)/\(stamps.goal)"))
            Panel {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 5), spacing: 10) {
                    ForEach(0..<stamps.goal, id: \.self) { i in
                        let on = i < stamps.count
                        let last = i == stamps.goal - 1
                        ZStack {
                            Circle()
                                .fill(on ? AnyShapeStyle(look.gradient) : AnyShapeStyle(Color.clear))
                            Circle()
                                .strokeBorder(on ? Color.clear : Theme.line, style: StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                            Image(systemName: on ? "checkmark" : last ? "gift" : "seal")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(on ? look.ink : Theme.ink3)
                        }
                        .aspectRatio(1, contentMode: .fit)
                        .scaleEffect(on && i == stamps.count - 1 ? 1.06 : 1)
                        .animation(.spring(duration: 0.35, bounce: 0.5), value: stamps.count)
                    }
                }
                if !stamps.reward.isEmpty {
                    Label(stamps.reward, systemImage: "gift").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink2)
                }
                if stamps.isFull {
                    Button {
                        store.redeemStamps(card.id)
                        store.show(L("Odměna využita, sbíráš znovu", "Reward used, collecting again"))
                        tick += 1
                    } label: {
                        Label(L("Vyzvednout odměnu", "Use the reward"), systemImage: "party.popper")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                } else {
                    HStack(spacing: 10) {
                        Button {
                            if store.addStamp(card.id) {
                                store.confetti += 1
                                store.show(L("Odměna je tvoje!", "The reward is yours!"))
                            }
                            tick += 1
                        } label: {
                            Label(L("+1 razítko", "+1 stamp"), systemImage: "seal")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        if stamps.count > 0 {
                            Button {
                                store.removeStamp(card.id)
                            } label: {
                                Image(systemName: "arrow.uturn.backward")
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .frame(width: 70)
                        }
                    }
                }
                if stamps.redeemed > 0 {
                    Text(L("Vyzvednuté odměny: \(stamps.redeemed)", "Rewards used: \(stamps.redeemed)"))
                        .font(.footnote)
                        .foregroundStyle(Theme.ink2)
                }
            }
        }
        .sensoryFeedback(.success, trigger: tick)
    }
}

// MARK: - Points

struct PointsSection: View {
    let card: Card
    @Environment(Store.self) private var store
    @State private var editing = false
    @State private var value = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: L("Body", "Points"))
            Panel {
                HStack {
                    Text(card.points.map { $0.formatted() } ?? "—")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundStyle(Theme.ink)
                    Spacer()
                    Button {
                        value = card.points.map(String.init) ?? ""
                        editing = true
                    } label: {
                        Label(L("Změnit", "Edit"), systemImage: "pencil")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(width: 130)
                }
                if let goal = card.pointsGoal, goal > 0 {
                    let points = card.points ?? 0
                    ProgressView(value: Double(min(points, goal)), total: Double(goal))
                        .tint(Theme.accent)
                    Text(points >= goal ? L("Cíl splněn!", "Goal reached!") : L("Do cíle zbývá \(goal - points)", "\(goal - points) to go"))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.ink)
                }
            }
        }
        .alert(L("Kolik máš bodů?", "How many points?"), isPresented: $editing) {
            TextField("0", text: $value)
                .keyboardType(.numberPad)
            Button(L("Uložit", "Save")) {
                let digits = value.filter(\.isNumber)
                store.updateCard(card.id) { $0.points = digits.isEmpty ? nil : Int(digits) }
            }
            Button(L("Zrušit", "Cancel"), role: .cancel) {}
        }
    }
}

// MARK: - Spending

struct SpendingSection: View {
    let card: Card
    @Environment(Store.self) private var store

    var body: some View {
        let month = store.purchases(inMonthOf: Date()).filter { $0.cardID == card.id }
        let spent = month.reduce(0) { $0 + $1.amount }
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: L("Útraty tento měsíc", "Spent this month"))
            Panel {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(money(spent, store.settings.currency))
                            .font(.system(size: 34, weight: .bold))
                            .foregroundStyle(Theme.ink)
                        Text(L("\(month.count)× nákup", "\(month.count) purchase(s)"))
                            .font(.footnote)
                            .foregroundStyle(Theme.ink2)
                    }
                    Spacer()
                    Button {
                        store.sheet = .logSpend(card.id)
                    } label: {
                        Label(L("Zapsat", "Log"), systemImage: "plus")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .frame(width: 120)
                }
            }
        }
    }
}

// MARK: - Places

struct PlacesSection: View {
    let card: Card
    @Environment(Store.self) private var store
    @State private var searching = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(title: L("Místa", "Places"), count: card.places.count)
            if !card.places.isEmpty {
                Map(initialPosition: .automatic) {
                    ForEach(card.places) { place in
                        Marker(place.label.isEmpty ? card.name : place.label,
                               coordinate: CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude))
                            .tint(card.look.dot)
                    }
                    UserAnnotation()
                }
                .frame(height: 190)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .allowsHitTesting(false)
            }
            Panel {
                if card.places.isEmpty {
                    Text(L("Ulož místo obchodu a karta tam sama vyskočí.", "Save the shop's place and the card pops up there by itself."))
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2)
                }
                ForEach(card.places) { place in
                    HStack(spacing: 10) {
                        Image(systemName: "mappin.circle.fill").foregroundStyle(card.look.dot)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(place.label.isEmpty ? L("Uložené místo", "Saved place") : place.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(Theme.ink)
                                .lineLimit(1)
                            if let here = store.location {
                                let d = CLLocation(latitude: place.latitude, longitude: place.longitude).distance(from: here)
                                Text(distanceText(d)).font(.caption).foregroundStyle(Theme.ink2)
                            }
                        }
                        Spacer()
                        Button {
                            store.removePlace(card.id, place.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.ink3)
                        }
                        .buttonStyle(.plain)
                    }
                }
                HStack(spacing: 10) {
                    Button {
                        if let here = store.location {
                            store.addPlace(card.id, Place(latitude: here.coordinate.latitude, longitude: here.coordinate.longitude))
                            store.show(L("Místo uloženo", "Place saved"))
                        } else {
                            LocationService.shared.requestWhenInUse()
                            store.show(L("Hledám polohu…", "Finding your location…"))
                        }
                    } label: {
                        Label(L("Tady", "Here"), systemImage: "location.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        searching = true
                    } label: {
                        Label(L("Adresa", "Address"), systemImage: "magnifyingglass")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
        }
        .sheet(isPresented: $searching) {
            AddressSearchSheet(card: card)
        }
    }
}
