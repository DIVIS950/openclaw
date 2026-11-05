import CoreLocation
import MapKit
import SwiftUI

/// Shows whichever sheet the store asks for.
struct SheetHost: View {
    let sheet: AppSheet
    @Environment(Store.self) private var store

    var body: some View {
        switch sheet {
        case let .addCard(kind):
            AddCardFlow(kind: kind)
        case let .editCard(id):
            if let card = store.card(id) {
                NavigationStack {
                    CardFormView(original: card, isNew: false)
                }
            }
        case let .addCoupon(cardID):
            NavigationStack {
                CouponFormView(original: Coupon(title: "", cardID: cardID), isNew: true)
            }
        case let .editCoupon(id):
            if let coupon = store.coupon(id) {
                NavigationStack {
                    CouponFormView(original: coupon, isNew: false)
                }
            }
        case let .promo(id):
            PromoSheet(cardID: id)
        case let .pay(id):
            PaySheet(cardID: id)
        case let .logSpend(id):
            LogSpendSheet(cardID: id)
        }
    }
}

// MARK: - Pay with a gift card

struct PaySheet: View {
    let cardID: UUID
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var amount = ""
    @State private var settingBalance = false
    @State private var error = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            if let card = store.card(cardID) {
                let balance = card.balance ?? 0
                ScrollView {
                    VStack(spacing: 16) {
                        WalletCardView(card: card, distance: nil, coupons: 0, isHere: false)
                        Text(settingBalance ? L("Zůstatek na kartě", "Balance on the card") : L("Kolik platíš", "Amount to pay"))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.ink2)
                        TextField("0", text: $amount)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 44, weight: .bold))
                            .multilineTextAlignment(.center)
                            .focused($focused)
                            .padding(.vertical, 8)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
                            .foregroundStyle(Theme.ink)
                        if !settingBalance, balance > 0 {
                            Button(L("Celý zůstatek · \(money(balance, store.settings.currency))", "All of it · \(money(balance, store.settings.currency))")) {
                                amount = plain(balance)
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Theme.accent)
                        }
                        if !error.isEmpty {
                            Text(error).font(.subheadline.weight(.semibold)).foregroundStyle(.red)
                        }
                        Button {
                            submit(card)
                        } label: {
                            Label(settingBalance ? L("Uložit zůstatek", "Save balance") : L("Zaplatit", "Pay"),
                                  systemImage: settingBalance ? "checkmark" : "wallet.pass")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        Button(settingBalance ? L("Zpět k placení", "Back to paying") : L("Je zůstatek jinak? Upravit", "Balance is different? Fix it")) {
                            settingBalance.toggle()
                            amount = settingBalance ? plain(balance) : ""
                            error = ""
                        }
                        .font(.subheadline)
                        .foregroundStyle(Theme.ink2)
                    }
                    .padding(18)
                }
                .background(Theme.bg.ignoresSafeArea())
                .navigationTitle(settingBalance ? L("Zůstatek", "Balance") : L("Zaplatit dárkovou kartou", "Pay with gift card"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button(L("Zrušit", "Cancel")) { dismiss() }
                    }
                }
                .onAppear { focused = true }
            }
        }
        .presentationDetents([.large])
    }

    private func plain(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)).grouping(.never))
    }

    private func submit(_ card: Card) {
        guard let value = parseMoney(amount), value >= 0, settingBalance || value > 0 else {
            error = L("Napiš částku.", "Type an amount.")
            return
        }
        let currency = store.settings.currency
        if settingBalance {
            store.setBalance(card.id, value)
            store.show(L("Zůstatek uložen", "Balance saved"))
            dismiss()
            return
        }
        let balance = card.balance ?? 0
        guard value <= balance + 0.001 else {
            error = L("Na kartě je jen \(money(balance, currency)).", "Only \(money(balance, currency)) left on the card.")
            return
        }
        if let purchase = store.pay(card.id, amount: value) {
            let left = store.card(card.id)?.balance ?? 0
            let shared = store
            store.show(
                L("Zaplaceno \(money(value, currency)) · zbývá \(money(left, currency))", "Paid \(money(value, currency)) · \(money(left, currency)) left"),
                actionTitle: L("Vrátit", "Undo")
            ) {
                shared.undoPayment(purchase.id)
            }
        }
        dismiss()
    }
}

// MARK: - Promo code for a card

struct PromoSheet: View {
    let cardID: UUID
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var discount = ""
    @State private var hasExpiry = false
    @State private var expiry = Date().addingTimeInterval(14 * 86_400)

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(L("Kód, např. LETO20", "Code, e.g. SUMMER20"), text: $code)
                        .font(.system(.title3, design: .monospaced))
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                } header: {
                    Text(L("Promo kód", "Promo code"))
                }
                Section {
                    TextField(L("Co dává, např. −20 %", "What it gives, e.g. −20%"), text: $discount)
                    Toggle(L("Platí do", "Valid until"), isOn: $hasExpiry)
                    if hasExpiry {
                        DatePicker(L("Datum", "Date"), selection: $expiry, displayedComponents: .date)
                    }
                } footer: {
                    Text(L("Kód uvidíš pod kartou, když přijdeš do obchodu, i s tlačítkem Kopírovat.",
                           "You'll see the code under the card when you walk into the shop, with a Copy button."))
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(store.card(cardID)?.name ?? L("Promo kód", "Promo code"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Zrušit", "Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Uložit", "Save")) { save() }
                        .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        let clean = code.trimmingCharacters(in: .whitespaces)
        let coupon = Coupon(
            title: L("Promo kód", "Promo code"),
            discount: String(discount.trimmingCharacters(in: .whitespaces).prefix(24)),
            cardID: cardID,
            shop: store.card(cardID)?.name ?? "",
            code: clean,
            format: Barcodes.guess(clean),
            expiry: hasExpiry ? expiry : nil
        )
        store.saveCoupon(coupon)
        store.confetti += 1
        store.show(L("Promo kód uložen", "Promo code saved"))
        dismiss()
    }
}

// MARK: - Log spending

struct LogSpendSheet: View {
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var cardID: UUID?
    @State private var amount = ""
    @State private var shop = ""
    @State private var saved = ""
    @State private var date = Date()
    @State private var fromGift = true
    @State private var error = ""

    init(cardID: UUID?) {
        _cardID = State(initialValue: cardID)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("0", text: $amount)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 34, weight: .bold))
                } header: {
                    Text(L("Kolik jsi utratil(a) (\(store.settings.currency))", "How much you spent (\(store.settings.currency))"))
                }
                Section {
                    Picker(L("Obchod", "Shop"), selection: $cardID) {
                        Text(L("Jiný obchod", "Other shop")).tag(UUID?.none)
                        ForEach(store.cards) { card in
                            Text(card.name).tag(UUID?.some(card.id))
                        }
                    }
                    if cardID == nil {
                        TextField(L("Název obchodu", "Shop name"), text: $shop)
                    }
                    if let id = cardID, let card = store.card(id), card.isGift, Calendar.current.isDateInToday(date) {
                        Toggle(L("Zaplaceno dárkovou kartou (zbývá \(money(card.balance ?? 0, store.settings.currency)))",
                                 "Paid with the gift card (\(money(card.balance ?? 0, store.settings.currency)) left)"), isOn: $fromGift)
                    }
                    DatePicker(L("Kdy", "When"), selection: $date, in: ...Date(), displayedComponents: .date)
                }
                Section {
                    TextField("0", text: $saved).keyboardType(.decimalPad)
                } header: {
                    Text(L("Ušetřeno (nepovinné)", "Saved (optional)"))
                }
                if !error.isEmpty {
                    Text(error).foregroundStyle(.red)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(L("Zapsat útratu", "Log spending"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Zrušit", "Cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Uložit", "Save")) { save() }
                }
            }
        }
    }

    private func save() {
        guard let value = parseMoney(amount), value > 0 else {
            error = L("Napiš částku.", "Type an amount.")
            return
        }
        let card = cardID.flatMap { store.card($0) }
        if let card, card.isGift, fromGift, Calendar.current.isDateInToday(date) {
            guard value <= (card.balance ?? 0) + 0.001 else {
                error = L("Na kartě je jen \(money(card.balance ?? 0, store.settings.currency)).", "Only \(money(card.balance ?? 0, store.settings.currency)) left on the card.")
                return
            }
            store.pay(card.id, amount: value)
        } else {
            let name = card?.name ?? shop.trimmingCharacters(in: .whitespaces)
            store.logPurchase(Purchase(cardID: card?.id, shop: name, amount: value, saved: parseMoney(saved) ?? 0, date: date))
        }
        store.show(L("Zapsáno", "Saved"))
        dismiss()
    }
}

// MARK: - Find a shop's address

struct AddressSearchSheet: View {
    let card: Card
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var hits: [Hit] = []
    @State private var busy = false
    @State private var nothing = false

    struct Hit: Identifiable {
        let id = UUID()
        let name: String
        let detail: String
        let latitude: Double
        let longitude: Double
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        TextField(L("Obchod nebo adresa", "Shop or address"), text: $query)
                            .submitLabel(.search)
                            .onSubmit { Task { await search() } }
                        if busy {
                            ProgressView()
                        } else {
                            Button {
                                Task { await search() }
                            } label: {
                                Image(systemName: "magnifyingglass")
                            }
                        }
                    }
                }
                if nothing {
                    Text(L("Nic jsem nenašel.", "Nothing found.")).foregroundStyle(.secondary)
                }
                ForEach(hits) { hit in
                    Button {
                        store.addPlace(card.id, Place(latitude: hit.latitude, longitude: hit.longitude, label: [hit.name, hit.detail].filter { !$0.isEmpty }.joined(separator: ", ")))
                        store.show(L("Místo uloženo", "Place saved"))
                        dismiss()
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hit.name).font(.headline).foregroundStyle(Theme.ink)
                            if !hit.detail.isEmpty {
                                Text(hit.detail).font(.footnote).foregroundStyle(Theme.ink2)
                            }
                            if let here = store.location {
                                let d = CLLocation(latitude: hit.latitude, longitude: hit.longitude).distance(from: here)
                                Text(distanceText(d)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                }
            }
            .navigationTitle(L("Najít místo", "Find a place"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Zrušit", "Cancel")) { dismiss() }
                }
            }
            .onAppear {
                if query.isEmpty {
                    query = card.name
                }
            }
        }
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return }
        busy = true
        nothing = false
        defer { busy = false }
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = text
        if let here = store.location {
            request.region = MKCoordinateRegion(center: here.coordinate, latitudinalMeters: 30_000, longitudinalMeters: 30_000)
        }
        do {
            let response = try await MKLocalSearch(request: request).start()
            hits = response.mapItems.prefix(15).map { item in
                Hit(
                    name: item.name ?? text,
                    detail: item.placemark.title ?? "",
                    latitude: item.placemark.coordinate.latitude,
                    longitude: item.placemark.coordinate.longitude
                )
            }
            nothing = hits.isEmpty
        } catch {
            hits = []
            nothing = true
        }
    }
}
