import SwiftUI
import UIKit

/// Coupons tab: active, ending soon and used coupons and promo codes.
struct CouponsView: View {
    @Environment(Store.self) private var store
    @State private var filter: Filter = .active

    enum Filter: Hashable {
        case active, soon, used
    }

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.couponsPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Button {
                        store.sheet = .addCoupon(nil)
                    } label: {
                        Label(L("Přidat kupón nebo promo kód", "Add a coupon or promo code"), systemImage: "plus")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    ChipPicker(options: [
                        (.active, L("Aktivní · \(active.count)", "Active · \(active.count)")),
                        (.soon, L("Brzy končí · \(soon.count)", "Ending soon · \(soon.count)")),
                        (.used, L("Použité · \(used.count)", "Used · \(used.count)")),
                    ], selection: $filter)
                    let list = filter == .active ? active : filter == .soon ? soon : used
                    if list.isEmpty {
                        Text(filter == .used ? L("Zatím nic použitého.", "Nothing used yet.") : L("Žádné kupóny. Přidej první!", "No coupons. Add your first!"))
                            .foregroundStyle(Theme.ink2)
                            .frame(maxWidth: .infinity, minHeight: 100)
                    }
                    ForEach(list) { coupon in
                        NavigationLink(value: CouponRoute(id: coupon.id)) {
                            CouponRow(coupon: coupon)
                        }
                        .buttonStyle(LiftButtonStyle())
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(L("Kupóny", "Coupons"))
            .navigationDestination(for: CouponRoute.self) { route in
                CouponDetailView(couponID: route.id)
            }
            .navigationDestination(for: CardRoute.self) { route in
                CardDetailView(cardID: route.id)
            }
        }
    }

    private var active: [Coupon] {
        store.coupons.filter { store.isActive($0) }.sorted { ($0.expiry ?? .distantFuture) < ($1.expiry ?? .distantFuture) }
    }

    private var soon: [Coupon] {
        active.filter { ($0.expiry?.daysFromToday ?? 99) <= store.settings.remindDays }
    }

    private var used: [Coupon] {
        store.coupons.filter(\.used).sorted { ($0.usedAt ?? .distantPast) > ($1.usedAt ?? .distantPast) }
    }
}

/// "Ends in 3 days", "ends today", "expired", "used".
func couponStatus(_ c: Coupon, remindDays: Int) -> (text: String, warn: Bool) {
    if c.used {
        return (L("Použito", "Used"), false)
    }
    guard let e = c.expiry else {
        return (L("Bez data", "No end date"), false)
    }
    let days = e.daysFromToday
    if days < 0 {
        return (L("Prošlý", "Expired"), true)
    }
    if days == 0 {
        return (L("Končí dnes", "Ends today"), true)
    }
    return (L("Ještě \(days) d", "\(days) days left"), days <= remindDays)
}

struct CouponRow: View {
    let coupon: Coupon
    @Environment(Store.self) private var store

    var body: some View {
        let card = coupon.cardID.flatMap { store.card($0) }
        let look = card?.look ?? Looks.look(colorHex: "#FF6B6B", category: .other, kind: .loyalty)
        let status = couponStatus(coupon, remindDays: store.settings.remindDays)
        HStack(spacing: 0) {
            Group {
                if coupon.discount.isEmpty {
                    Image(systemName: "ticket").font(.title)
                } else {
                    Text(coupon.discount)
                        .font(.system(size: 22, weight: .heavy))
                        .minimumScaleFactor(0.5)
                        .lineLimit(2)
                        .multilineTextAlignment(.center)
                }
            }
            .foregroundStyle(look.ink)
            .padding(8)
            .frame(width: 96)
            .frame(maxHeight: .infinity)
            .background(look.gradient)
            VStack(alignment: .leading, spacing: 5) {
                Text(coupon.title).font(.headline).lineLimit(2).foregroundStyle(Theme.ink)
                let shop = store.shopName(of: coupon)
                if !shop.isEmpty {
                    HStack(spacing: 6) {
                        Circle().fill(look.dot).frame(width: 8, height: 8)
                        Text(shop).font(.footnote).foregroundStyle(Theme.ink2)
                    }
                }
                Text(status.text)
                    .font(.caption.weight(.bold))
                    .padding(.horizontal, 9)
                    .frame(height: 24)
                    .background(status.warn ? Theme.warn.opacity(0.14) : Theme.surface2, in: Capsule())
                    .foregroundStyle(status.warn ? Theme.warn : Theme.ink2)
            }
            .padding(14)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 100)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line))
        .shadow(color: .black.opacity(0.05), radius: 8, y: 3)
        .opacity(coupon.used ? 0.55 : 1)
    }
}

struct CouponDetailView: View {
    let couponID: UUID
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var askingSaved = false
    @State private var savedText = ""
    @State private var confirmDelete = false

    var body: some View {
        if let coupon = store.coupon(couponID) {
            let card = coupon.cardID.flatMap { store.card($0) }
            let look = card?.look ?? Looks.look(colorHex: "#FF6B6B", category: .other, kind: .loyalty)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 12) {
                        if !store.shopName(of: coupon).isEmpty {
                            Text(store.shopName(of: coupon)).font(.subheadline.weight(.semibold)).opacity(0.9)
                        }
                        if !coupon.discount.isEmpty {
                            Text(coupon.discount).font(.system(size: 56, weight: .heavy)).minimumScaleFactor(0.5).lineLimit(1)
                        }
                        Text(coupon.title).font(.title2.weight(.bold))
                        Text(couponStatus(coupon, remindDays: store.settings.remindDays).text)
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(Color.white.opacity(0.26), in: Capsule())
                        if !coupon.code.isEmpty {
                            CodePanel(code: coupon.code, format: coupon.format) {
                                store.bigCode = BigCode(code: coupon.code, format: coupon.format, name: coupon.title)
                            }
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(look.ink)
                    .background(CardBackground(look: look))
                    .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .shadow(color: look.shadow, radius: 14, y: 8)

                    if coupon.used {
                        Button {
                            var c = coupon
                            c.used = false
                            c.usedAt = nil
                            c.saved = nil
                            store.saveCoupon(c)
                        } label: {
                            Label(L("Ještě nepoužito", "Not used yet"), systemImage: "arrow.uturn.backward")
                        }
                        .buttonStyle(SecondaryButtonStyle())
                    } else {
                        Button {
                            savedText = ""
                            askingSaved = true
                        } label: {
                            Label(L("Použito", "Used"), systemImage: "checkmark.circle")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                    }
                    if !coupon.note.isEmpty {
                        Panel {
                            Text(L("Podmínky", "Conditions")).font(.footnote).foregroundStyle(Theme.ink2)
                            Text(coupon.note).foregroundStyle(Theme.ink)
                        }
                    }
                    if let card {
                        NavigationLink(value: CardRoute(id: card.id)) {
                            HStack(spacing: 12) {
                                LogoView(card: card, size: 40)
                                    .background(card.look.gradient, in: Circle())
                                VStack(alignment: .leading) {
                                    Text(L("Karta", "Card")).font(.caption).foregroundStyle(Theme.ink2)
                                    Text(card.name).font(.headline).foregroundStyle(Theme.ink)
                                }
                                Spacer()
                                Image(systemName: "chevron.right").foregroundStyle(Theme.ink3)
                            }
                            .padding(14)
                            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
                        }
                        .buttonStyle(.plain)
                    }
                    Button(role: .destructive) {
                        confirmDelete = true
                    } label: {
                        Label(L("Smazat kupón", "Delete coupon"), systemImage: "trash").frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L("Upravit", "Edit")) {
                        store.sheet = .editCoupon(coupon.id)
                    }
                }
            }
            .alert(L("Kolik jsi ušetřil(a)?", "How much did you save?"), isPresented: $askingSaved) {
                TextField("0", text: $savedText).keyboardType(.decimalPad)
                Button(L("Uložit", "Save")) {
                    store.useCoupon(coupon.id, saved: parseMoney(savedText))
                    store.confetti += 1
                    store.show(L("Kupón použit", "Coupon used"))
                }
                Button(L("Přeskočit", "Skip")) {
                    store.useCoupon(coupon.id, saved: nil)
                    store.show(L("Kupón použit", "Coupon used"))
                }
                Button(L("Zrušit", "Cancel"), role: .cancel) {}
            }
            .confirmationDialog(L("Opravdu smazat kupón?", "Delete this coupon?"), isPresented: $confirmDelete, titleVisibility: .visible) {
                Button(L("Smazat", "Delete"), role: .destructive) {
                    dismiss()
                    store.deleteCoupon(coupon.id)
                }
            }
        } else {
            ContentUnavailableView(L("Kupón už není", "Coupon not found"), systemImage: "ticket")
        }
    }
}

/// New or edited coupon / promo code.
struct CouponFormView: View {
    let isNew: Bool
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var coupon: Coupon
    @State private var hasExpiry: Bool
    @State private var expiry: Date
    @State private var scanning = false

    init(original: Coupon, isNew: Bool) {
        self.isNew = isNew
        _coupon = State(initialValue: original)
        _hasExpiry = State(initialValue: original.expiry != nil)
        _expiry = State(initialValue: original.expiry ?? Date().addingTimeInterval(14 * 86_400))
    }

    var body: some View {
        Form {
            Section {
                TextField(L("Sleva, např. −20 % nebo 1+1", "Discount, e.g. −20% or 2 for 1"), text: $coupon.discount)
                TextField(L("Na co, např. Celý nákup", "What for, e.g. Whole shop"), text: $coupon.title)
            } header: {
                Text(L("Kupón", "Coupon"))
            }
            Section {
                Picker(L("Karta", "Card"), selection: $coupon.cardID) {
                    Text(L("Žádná", "None")).tag(UUID?.none)
                    ForEach(store.cards) { card in
                        Text(card.name).tag(UUID?.some(card.id))
                    }
                }
                if coupon.cardID == nil {
                    TextField(L("Obchod", "Shop"), text: $coupon.shop)
                }
            } header: {
                Text(L("Obchod", "Shop"))
            } footer: {
                Text(L("S kartou se kupón ukáže, když přijdeš do obchodu.", "With a card, the coupon shows up when you walk into the shop."))
            }
            Section {
                TextField(L("Kód nebo promo kód", "Code or promo code"), text: $coupon.code)
                    .font(.system(.body, design: .monospaced))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Picker(L("Typ kódu", "Code type"), selection: $coupon.format) {
                    ForEach(BarcodeFormat.allCases) { format in
                        Text(format.label).tag(format)
                    }
                }
                Button {
                    scanning = true
                } label: {
                    Label(L("Naskenovat kód", "Scan the code"), systemImage: "barcode.viewfinder")
                }
            } header: {
                Text(L("Kód", "Code"))
            }
            Section {
                Toggle(L("Platí do", "Valid until"), isOn: $hasExpiry)
                if hasExpiry {
                    DatePicker(L("Datum", "Date"), selection: $expiry, displayedComponents: .date)
                }
                TextField(L("Podmínky, např. nad 300 Kč", "Conditions, e.g. over 300"), text: $coupon.note, axis: .vertical)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(isNew ? L("Nový kupón", "New coupon") : L("Upravit kupón", "Edit coupon"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(L("Zrušit", "Cancel")) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Uložit", "Save")) { save() }
                    .fontWeight(.bold)
                    .disabled(coupon.title.trimmingCharacters(in: .whitespaces).isEmpty && coupon.discount.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                ScanStep(kind: .loyalty) { scanned in
                    coupon.code = scanned.value
                    coupon.format = scanned.format
                    scanning = false
                } onManual: {
                    scanning = false
                }
            }
        }
    }

    private func save() {
        var c = coupon
        c.title = c.title.trimmingCharacters(in: .whitespaces)
        c.discount = c.discount.trimmingCharacters(in: .whitespaces)
        if c.title.isEmpty {
            c.title = c.discount
        }
        c.code = c.code.trimmingCharacters(in: .whitespaces)
        if c.code.isEmpty {
            c.format = .none
        } else if c.format == .none {
            c.format = Barcodes.guess(c.code)
        }
        c.expiry = hasExpiry ? expiry : nil
        store.saveCoupon(c)
        store.show(isNew ? L("Kupón uložen", "Coupon saved") : L("Uloženo", "Saved"))
        dismiss()
    }
}
