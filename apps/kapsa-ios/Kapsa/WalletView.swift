import SwiftUI
import UIKit

/// Cards tab: the shop you're in takes over the top (its card ready to scan, its promo
/// codes and gift card money); below, all cards stacked like in a real wallet.
struct WalletView: View {
    @Environment(Store.self) private var store
    @State private var filter: WalletFilter = .all

    enum WalletFilter: Hashable {
        case all, near, coupons, stamps, gift
    }

    var body: some View {
        @Bindable var store = store
        NavigationStack(path: $store.walletPath) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if store.cards.isEmpty {
                        EmptyWallet()
                    } else {
                        if let here = store.hereCard {
                            HereCardView(card: here.card, distance: here.distance)
                            PromoListView(card: here.card)
                        } else {
                            HomeHeader()
                        }
                        HStack {
                            SectionTitle(title: L("Moje karty", "My cards"), count: store.cards.count)
                            AddMenu(compact: true)
                        }
                        .padding(.top, 6)
                        ChipPicker(options: filterOptions, selection: $filter)
                        stack
                    }
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 40)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("Kapsa")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    AddMenu(compact: false)
                }
            }
            .navigationDestination(for: CardRoute.self) { route in
                CardDetailView(cardID: route.id)
            }
            .navigationDestination(for: CouponRoute.self) { route in
                CouponDetailView(couponID: route.id)
            }
        }
    }

    private var filterOptions: [(WalletFilter, String)] {
        var options: [(WalletFilter, String)] = [
            (.all, L("Vše", "All")),
            (.near, L("V okolí", "Nearby")),
            (.coupons, L("S kupóny", "With coupons")),
            (.stamps, L("Razítka", "Stamps")),
        ]
        if store.cards.contains(where: \.isGift) {
            options.append((.gift, L("Dárkové", "Gift cards")))
        }
        return options
    }

    private var visibleCards: [Card] {
        store.walletOrder().filter { card in
            switch filter {
            case .all: true
            case .near: (store.distance(to: card) ?? .infinity) < 2000
            case .coupons: !store.activeCoupons(for: card).isEmpty
            case .stamps: card.stamps != nil
            case .gift: card.isGift
            }
        }
    }

    @ViewBuilder
    private var stack: some View {
        let cards = visibleCards
        if cards.isEmpty {
            Text(L("Nic tu není.", "Nothing here."))
                .foregroundStyle(Theme.ink2)
                .frame(maxWidth: .infinity, minHeight: 80)
        } else {
            let hereID = store.hereCard?.card.id
            VStack(spacing: -54) {
                ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                    NavigationLink(value: CardRoute(id: card.id)) {
                        WalletCardView(
                            card: card,
                            distance: store.distance(to: card),
                            coupons: store.activeCoupons(for: card).count,
                            isHere: card.id == hereID
                        )
                    }
                    .buttonStyle(LiftButtonStyle())
                    .zIndex(Double(index))
                }
            }
        }
    }
}

/// "+" menu: card, gift card, coupon or promo code, spending.
struct AddMenu: View {
    let compact: Bool
    @Environment(Store.self) private var store

    var body: some View {
        Menu {
            Button {
                store.sheet = .addCard(.loyalty)
            } label: {
                Label(L("Kartu", "Card"), systemImage: "creditcard")
            }
            Button {
                store.sheet = .addCard(.gift)
            } label: {
                Label(L("Dárkovou kartu", "Gift card"), systemImage: "gift")
            }
            Button {
                store.sheet = .addCoupon(nil)
            } label: {
                Label(L("Kupón nebo promo kód", "Coupon or promo code"), systemImage: "ticket")
            }
            Button {
                store.sheet = .logSpend(nil)
            } label: {
                Label(L("Útratu", "Spending"), systemImage: "cart")
            }
        } label: {
            if compact {
                Label(L("Přidat", "Add"), systemImage: "plus")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.accent)
            } else {
                Image(systemName: "plus.circle.fill")
                    .font(.title2)
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, Theme.accent)
            }
        }
    }
}

/// You're in a shop: its card, big and ready to scan, with quick actions.
struct HereCardView: View {
    let card: Card
    let distance: Double
    @Environment(Store.self) private var store
    @State private var stampTick = 0

    var body: some View {
        let look = card.look
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Label(L("Jsi tady · \(distanceText(distance))", "You're here · \(distanceText(distance))"), systemImage: "location.fill")
                        .font(.caption.weight(.bold))
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(Color.white.opacity(0.26), in: Capsule())
                    NavigationLink(value: CardRoute(id: card.id)) {
                        Text(card.name)
                            .font(.system(size: 28, weight: .bold))
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                    if !subtitle.isEmpty {
                        Text(subtitle).font(.subheadline.weight(.semibold)).opacity(0.92)
                    }
                }
                Spacer(minLength: 8)
                LogoView(card: card, size: 54)
            }
            CodePanel(code: card.code, format: card.format) {
                store.markUsed(card.id)
                store.bigCode = BigCode(code: card.code, format: card.format, name: card.name)
            }
            if card.isGift, !card.pin.isEmpty {
                PinRow(pin: card.pin, onCard: true)
            }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], alignment: .leading, spacing: 8) {
                if card.isGift {
                    Button {
                        store.sheet = .pay(card.id)
                    } label: {
                        Label(L("Zaplatit kartou", "Pay with card"), systemImage: "wallet.pass").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GlassButtonStyle(strong: true))
                }
                if let stamps = card.stamps {
                    Button {
                        if store.addStamp(card.id) {
                            store.confetti += 1
                            store.show(L("Odměna je tvoje!", "The reward is yours!"))
                        } else {
                            store.show(L("Razítko přidáno · \(min(stamps.count + 1, stamps.goal))/\(stamps.goal)", "Stamp added · \(min(stamps.count + 1, stamps.goal))/\(stamps.goal)"))
                        }
                        stampTick += 1
                    } label: {
                        Label(L("+1 razítko", "+1 stamp"), systemImage: "seal").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GlassButtonStyle(strong: true))
                }
                Button {
                    store.markUsed(card.id)
                    store.bigCode = BigCode(code: card.code, format: card.format, name: card.name)
                } label: {
                    Label(L("Celá obrazovka", "Full screen"), systemImage: "arrow.up.left.and.arrow.down.right").frame(maxWidth: .infinity)
                }
                .buttonStyle(GlassButtonStyle())
                if !card.isGift {
                    Button {
                        store.sheet = .logSpend(card.id)
                    } label: {
                        Label(L("Zapsat útratu", "Log spending"), systemImage: "cart").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GlassButtonStyle())
                }
            }
        }
        .padding(18)
        .foregroundStyle(look.ink)
        .background(CardBackground(look: look))
        .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
        .shadow(color: look.shadow, radius: 16, y: 10)
        .sensoryFeedback(.success, trigger: stampTick)
    }

    private var subtitle: String {
        var parts: [String] = []
        if card.isGift {
            parts.append(L("Zbývá \(money(card.balance ?? 0, store.settings.currency))", "\(money(card.balance ?? 0, store.settings.currency)) left"))
        }
        if let s = card.stamps {
            parts.append(L("Razítka \(s.count)/\(s.goal)", "Stamps \(s.count)/\(s.goal)"))
        }
        let coupons = store.activeCoupons(for: card).count
        if coupons > 0 {
            parts.append(L("\(coupons) kupón(y)", "\(coupons) coupon(s)"))
        }
        return parts.joined(separator: " · ")
    }
}

/// PIN hidden behind a tap (people stand next to you at the till).
struct PinRow: View {
    let pin: String
    var onCard = false
    @State private var shown = false

    var body: some View {
        HStack(spacing: 10) {
            Text("PIN").font(.caption.weight(.bold)).opacity(0.8)
            Text(shown ? pin : String(repeating: "•", count: min(8, max(4, pin.count))))
                .font(.system(.body, design: .monospaced).weight(.semibold))
            Spacer()
            Button(shown ? L("Skrýt", "Hide") : L("Ukázat", "Show")) {
                shown.toggle()
            }
            .buttonStyle(GlassButtonStyle(strong: true))
            if shown {
                CopyButton(text: pin, label: "")
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(onCard ? AnyShapeStyle(Color.white.opacity(0.24)) : AnyShapeStyle(Theme.surface2), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// Coupons and promo codes of one card, each with its code ready to copy.
struct PromoListView: View {
    let card: Card
    @Environment(Store.self) private var store

    var body: some View {
        let look = card.look
        VStack(spacing: 8) {
            ForEach(store.activeCoupons(for: card)) { coupon in
                HStack(spacing: 0) {
                    NavigationLink(value: CouponRoute(id: coupon.id)) {
                        HStack(spacing: 12) {
                            Group {
                                if coupon.discount.isEmpty {
                                    Image(systemName: "ticket")
                                } else {
                                    Text(coupon.discount).lineLimit(1).minimumScaleFactor(0.6)
                                }
                            }
                            .font(.subheadline.weight(.heavy))
                            .foregroundStyle(look.ink)
                            .frame(minWidth: 58, minHeight: 42)
                            .padding(.horizontal, 6)
                            .background(look.gradient, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(coupon.title).font(.subheadline.weight(.semibold)).lineLimit(1)
                                Text(coupon.code.isEmpty ? L("Bez kódu", "No code") : coupon.code)
                                    .font(.system(.footnote, design: .monospaced))
                                    .foregroundStyle(Theme.ink2)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(10)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if !coupon.code.isEmpty {
                        Divider().frame(height: 40)
                        Button {
                            UIPasteboard.general.string = coupon.code
                            store.show(L("Zkopírováno", "Copied"))
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(Theme.accent)
                                .frame(width: 52, height: 52)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .foregroundStyle(Theme.ink)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
            }
            Button {
                store.sheet = .promo(card.id)
            } label: {
                Label(L("Promo kód", "Promo code"), systemImage: "plus")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity, minHeight: 46)
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line, style: StrokeStyle(lineWidth: 1.5, dash: [5, 4])))
            }
            .buttonStyle(.plain)
        }
    }
}

/// Not in a shop: greeting, a summary, and location help.
struct HomeHeader: View {
    @Environment(Store.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(greeting)
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Theme.ink)
            let coupons = store.coupons.filter { store.isActive($0) }.count
            let rewards = store.cards.filter { $0.stamps?.isFull == true }.count
            HStack(spacing: 8) {
                SummaryChip(text: L("\(store.cards.count) karet", "\(store.cards.count) cards"), symbol: "creditcard")
                if coupons > 0 {
                    SummaryChip(text: L("\(coupons) kupónů", "\(coupons) coupons"), symbol: "ticket")
                }
                if rewards > 0 {
                    SummaryChip(text: L("\(rewards) odměna", "\(rewards) reward"), symbol: "gift")
                }
            }
            LocationPrompt()
        }
    }

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<11: return L("Dobré ráno", "Good morning")
        case 11..<18: return L("Dobrý den", "Hello")
        default: return L("Dobrý večer", "Good evening")
        }
    }
}

struct SummaryChip: View {
    let text: String
    let symbol: String

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.footnote.weight(.semibold))
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(Theme.surface, in: Capsule())
            .overlay(Capsule().stroke(Theme.line))
            .foregroundStyle(Theme.ink)
    }
}

/// Asks for location (needed for "the card pops up in the shop").
struct LocationPrompt: View {
    @Environment(Store.self) private var store

    var body: some View {
        switch store.locationStatus {
        case .notDetermined:
            prompt(
                title: L("Zapni polohu", "Turn on location"),
                body: L("Karta pak vyskočí sama, když přijdeš do obchodu.", "Then the card pops up by itself when you walk into the shop."),
                button: L("Zapnout", "Turn on")
            ) {
                LocationService.shared.requestWhenInUse()
            }
        case .denied, .restricted:
            prompt(
                title: L("Poloha je vypnutá", "Location is off"),
                body: L("Zapni ji v Nastavení iPhonu → Kapsa → Poloha.", "Turn it on in iPhone Settings → Kapsa → Location."),
                button: L("Otevřít", "Open")
            ) {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
        case .authorizedWhenInUse where store.settings.dwellOn:
            prompt(
                title: L("Připomínky i se zavřenou Kapsou", "Reminders with Kapsa closed"),
                body: L("Povol polohu „Vždy“ a Kapsa ti připomene kartu, i když je zavřená.", "Allow location \"Always\" and Kapsa reminds you even when it's closed."),
                button: L("Povolit", "Allow")
            ) {
                LocationService.shared.requestAlways()
            }
        default:
            EmptyView()
        }
    }

    private func prompt(title: String, body: String, button: String, action: @escaping () -> Void) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "location.circle.fill")
                .font(.system(size: 34))
                .foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.subheadline.weight(.bold)).foregroundStyle(Theme.ink)
                Text(body).font(.footnote).foregroundStyle(Theme.ink2)
            }
            Spacer(minLength: 4)
            Button(button, action: action)
                .font(.subheadline.weight(.bold))
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(Theme.grad, in: Capsule())
                .foregroundStyle(.white)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
    }
}

/// First start: what the app does, scan a card or try the demo.
struct EmptyWallet: View {
    @Environment(Store.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ZStack {
                ForEach(0..<3, id: \.self) { i in
                    let look = Looks.look(colorHex: ["#9FA8FF", "#2FCB86", "#FF9F43"][i], category: .other, kind: .loyalty)
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(look.gradient)
                        .frame(width: 160, height: 100)
                        .rotationEffect(.degrees([-12.0, 3, 14][i]))
                        .offset(x: [-70.0, 0, 70][i], y: [16.0, 0, 20][i])
                        .shadow(color: look.shadow, radius: 10, y: 6)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 150)
            Text(L("Kapsa je prázdná", "Your pocket is empty"))
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Theme.ink)
            Text(L("Naskenuj první kartu. Až příště přijdeš do obchodu, vyskočí sama.", "Scan your first card. Next time you walk into the shop, it pops up by itself."))
                .font(.headline)
                .foregroundStyle(Theme.ink2)
            VStack(alignment: .leading, spacing: 10) {
                step(1, L("Naskenuj kartu", "Scan a card"))
                step(2, L("Ulož obchod", "Save the shop"))
                step(3, L("V obchodě vyskočí sama", "It pops up in the shop"))
            }
            Button {
                store.sheet = .addCard(.loyalty)
            } label: {
                Label(L("Naskenovat kartu", "Scan a card"), systemImage: "barcode.viewfinder")
            }
            .buttonStyle(PrimaryButtonStyle())
            Button {
                store.addDemo()
                store.confetti += 1
            } label: {
                Label(L("Vyzkoušet s ukázkou", "Try a demo"), systemImage: "sparkles")
            }
            .buttonStyle(SecondaryButtonStyle())
            LocationPrompt()
        }
        .padding(.top, 8)
    }

    private func step(_ n: Int, _ text: String) -> some View {
        HStack(spacing: 12) {
            Text("\(n)")
                .font(.headline)
                .foregroundStyle(Theme.accent)
                .frame(width: 32, height: 32)
                .background(Theme.accent.opacity(0.12), in: Circle())
            Text(text).foregroundStyle(Theme.ink)
        }
    }
}
