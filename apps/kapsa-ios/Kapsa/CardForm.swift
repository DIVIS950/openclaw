import CoreLocation
import PhotosUI
import SwiftUI
import UIKit

/// New card or gift card: camera first, then the form.
struct AddCardFlow: View {
    let kind: CardKind
    @State private var draft: Card?

    var body: some View {
        NavigationStack {
            if let draft {
                CardFormView(original: draft, isNew: true)
            } else {
                ScanStep(kind: kind) { scanned in
                    draft = Card(name: "", code: scanned.value, format: scanned.format, kind: kind)
                } onManual: {
                    draft = Card(name: "", format: .none, kind: kind)
                }
            }
        }
    }
}

/// Live camera scanner with "from a photo" and "type it in" below.
struct ScanStep: View {
    let kind: CardKind
    let onCode: (ScannedCode) -> Void
    let onManual: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var photo: PhotosPickerItem?
    @State private var message = ""

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if CodeReader.liveScannerWorks {
                LiveScanner(onCode: onCode).ignoresSafeArea()
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "camera.fill").font(.system(size: 40))
                    Text(L("Živé skenování tu nejde (chybí kamera nebo povolení). Vyfoť kartu, nebo napiš číslo.",
                           "Live scanning isn't available here (no camera or no permission). Use a photo or type the number."))
                        .multilineTextAlignment(.center)
                }
                .foregroundStyle(.white)
                .padding(30)
            }
            VStack {
                Text(L("Namiř na čárový kód karty", "Point at the card's barcode"))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.5), in: Capsule())
                    .padding(.top, 12)
                Spacer()
                if !message.isEmpty {
                    Text(message)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(12)
                        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
                }
                HStack(spacing: 10) {
                    PhotosPicker(selection: $photo, matching: .images) {
                        Label(L("Z fotky", "From photo"), systemImage: "photo")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GlassButtonStyle(strong: true))
                    Button {
                        onManual()
                    } label: {
                        Label(L("Napsat ručně", "Type it in"), systemImage: "keyboard")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(GlassButtonStyle(strong: true))
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 24)
            }
        }
        .navigationTitle(kind == .gift ? L("Dárková karta", "Gift card") : L("Nová karta", "New card"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(L("Zrušit", "Cancel")) { dismiss() }
            }
        }
        .onChange(of: photo) {
            Task { await readPhoto() }
        }
    }

    private func readPhoto() async {
        guard let photo,
              let data = try? await photo.loadTransferable(type: Data.self),
              let image = UIImage(data: data)
        else { return }
        if let code = CodeReader.read(from: image) {
            onCode(code)
        } else {
            message = L("Na fotce jsem kód nenašel. Zkus jinou, nebo napiš číslo.", "No code found in the photo. Try another one or type the number.")
        }
    }
}

/// The card form, for new cards and for editing.
struct CardFormView: View {
    let isNew: Bool
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var card: Card
    @State private var initialText: String
    @State private var balanceText: String
    @State private var pointsText: String
    @State private var pointsGoalText: String
    @State private var hasExpiry: Bool
    @State private var expiry: Date
    @State private var stampsOn: Bool
    @State private var stampGoal: Int
    @State private var reward: String
    @State private var saveHere = true
    @State private var colorTouched: Bool
    @State private var logoItem: PhotosPickerItem?
    @State private var rescanning = false

    init(original: Card, isNew: Bool) {
        self.isNew = isNew
        _card = State(initialValue: original)
        let plain: (Double?) -> String = { value in
            value.map { $0.formatted(.number.precision(.fractionLength(0...2)).grouping(.never)) } ?? ""
        }
        _initialText = State(initialValue: plain(original.initialBalance))
        _balanceText = State(initialValue: plain(original.balance))
        _pointsText = State(initialValue: original.points.map(String.init) ?? "")
        _pointsGoalText = State(initialValue: original.pointsGoal.map(String.init) ?? "")
        _hasExpiry = State(initialValue: original.expiry != nil)
        _expiry = State(initialValue: original.expiry ?? Date().addingTimeInterval(365 * 86_400))
        _stampsOn = State(initialValue: original.stamps != nil)
        _stampGoal = State(initialValue: original.stamps?.goal ?? 10)
        _reward = State(initialValue: original.stamps?.reward ?? "")
        _colorTouched = State(initialValue: !isNew)
    }

    var body: some View {
        Form {
            Section {
                Picker(L("Druh karty", "Card type"), selection: $card.kind) {
                    Text(L("Věrnostní karta", "Loyalty card")).tag(CardKind.loyalty)
                    Text(L("Dárková karta", "Gift card")).tag(CardKind.gift)
                }
                .pickerStyle(.segmented)
                WalletCardView(card: preview, distance: nil, coupons: 0, isHere: false)
                    .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
            }
            .listRowBackground(Color.clear)

            Section {
                TextField(L("Název obchodu", "Shop name"), text: $card.name)
                    .textInputAutocapitalization(.words)
                    .onChange(of: card.name) {
                        if let brand = Brands.find(card.name) {
                            apply(brand)
                        }
                    }
                let suggestions = Brands.suggest(card.name, limit: 5)
                if !suggestions.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(suggestions, id: \.name) { brand in
                                Button {
                                    card.name = brand.name
                                    apply(brand)
                                } label: {
                                    HStack(spacing: 6) {
                                        Circle()
                                            .fill(Looks.look(colorHex: brand.color, category: brand.category, kind: .loyalty).dot)
                                            .frame(width: 10, height: 10)
                                        Text(brand.name)
                                    }
                                    .font(.subheadline.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .frame(height: 34)
                                    .background(Theme.surface2, in: Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
            } header: {
                Text(L("Obchod", "Shop"))
            }

            Section {
                TextField(L("Číslo pod čárovým kódem", "Number under the barcode"), text: $card.code)
                    .font(.system(.body, design: .monospaced))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .onChange(of: card.code) {
                        if card.format == .none || isNew {
                            card.format = Barcodes.guess(card.code)
                        }
                    }
                Picker(L("Typ kódu", "Code type"), selection: $card.format) {
                    ForEach(BarcodeFormat.allCases) { format in
                        Text(format.label).tag(format)
                    }
                }
                Button {
                    rescanning = true
                } label: {
                    Label(L("Naskenovat kód", "Scan the code"), systemImage: "barcode.viewfinder")
                }
            } header: {
                Text(card.isGift ? L("Číslo dárkové karty", "Gift card number") : L("Číslo karty", "Card number"))
            }

            if card.isGift {
                Section {
                    TextField(L("Hodnota karty, např. 1000", "Card value, e.g. 1000"), text: $initialText)
                        .keyboardType(.decimalPad)
                    TextField(L("Zbývá teď (když už jsi platil/a)", "Left now (if already used)"), text: $balanceText)
                        .keyboardType(.decimalPad)
                    TextField("PIN", text: $card.pin)
                        .font(.system(.body, design: .monospaced))
                        .autocorrectionDisabled()
                } header: {
                    Text(L("Peníze na kartě (\(store.settings.currency))", "Money on the card (\(store.settings.currency))"))
                }
            }

            Section {
                Toggle(L("Má datum platnosti", "Has an expiry date"), isOn: $hasExpiry)
                if hasExpiry {
                    DatePicker(L("Platí do", "Valid until"), selection: $expiry, displayedComponents: .date)
                }
            } footer: {
                Text(card.isGift
                    ? L("Kapsa ti připomene dva týdny předem, ať peníze nepropadnou.", "Kapsa reminds you two weeks before, so the money isn't lost.")
                    : L("Kapsa ti připomene, než karta skončí.", "Kapsa reminds you before the card expires."))
            }

            Section {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 40), spacing: 12)], spacing: 12) {
                    ForEach(Brands.swatches, id: \.self) { hex in
                        Circle()
                            .fill(Looks.look(colorHex: hex, category: card.category, kind: card.kind).gradient)
                            .frame(width: 40, height: 40)
                            .overlay(Circle().stroke(card.colorHex == hex ? Theme.accent : Color.clear, lineWidth: 3).padding(-4))
                            .onTapGesture {
                                card.colorHex = hex
                                colorTouched = true
                            }
                    }
                }
                .padding(.vertical, 6)
                ColorPicker(L("Vlastní barva", "Own colour"), selection: colorBinding, supportsOpacity: false)
            } header: {
                Text(L("Barva", "Colour"))
            }

            Section {
                HStack(spacing: 12) {
                    LogoView(card: card, size: 44)
                        .background(card.look.gradient, in: Circle())
                    TextField(Brands.find(card.name)?.domain ?? L("web obchodu, např. obchod.cz", "shop website, e.g. shop.com"), text: $card.website)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                PhotosPicker(selection: $logoItem, matching: .images) {
                    Label(L("Vlastní obrázek loga", "Own logo picture"), systemImage: "photo")
                }
                if card.logoData != nil {
                    Button(L("Odebrat obrázek", "Remove picture"), role: .destructive) {
                        card.logoData = nil
                    }
                }
            } header: {
                Text("Logo")
            } footer: {
                Text(L("Logo se vezme z webu obchodu. Nebo vyber vlastní obrázek.", "The logo comes from the shop's website, or pick your own picture."))
            }

            Section {
                Picker(L("Kategorie", "Category"), selection: $card.category) {
                    ForEach(ShopCategory.allCases) { category in
                        Label(category.name, systemImage: category.symbol).tag(category)
                    }
                }
                if !card.isGift {
                    Toggle(L("Sbírám razítka", "Collect stamps"), isOn: $stampsOn)
                    if stampsOn {
                        Stepper(L("Razítek na odměnu: \(stampGoal)", "Stamps for a reward: \(stampGoal)"), value: $stampGoal, in: 2...30)
                        TextField(L("Odměna, např. Káva zdarma", "Reward, e.g. Free coffee"), text: $reward)
                    }
                    TextField(L("Body", "Points"), text: $pointsText).keyboardType(.numberPad)
                    TextField(L("Cíl bodů (nepovinné)", "Points goal (optional)"), text: $pointsGoalText).keyboardType(.numberPad)
                }
                TextField(L("Poznámka", "Note"), text: $card.note, axis: .vertical)
                    .lineLimit(1...4)
            } header: {
                Text(L("Další", "More"))
            }

            if isNew, store.location != nil {
                Section {
                    Toggle(L("Uložit místo, kde právě jsem", "Save the place where I am"), isOn: $saveHere)
                } footer: {
                    Text(L("Až sem příště přijdeš, karta vyskočí sama.", "Next time you're here, the card pops up by itself."))
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(isNew ? (card.isGift ? L("Nová dárková karta", "New gift card") : L("Nová karta", "New card")) : L("Upravit kartu", "Edit card"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button(L("Zrušit", "Cancel")) { dismiss() }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Uložit", "Save")) { save() }
                    .fontWeight(.bold)
                    .disabled(card.name.trimmingCharacters(in: .whitespaces).isEmpty)
            }
        }
        .sheet(isPresented: $rescanning) {
            NavigationStack {
                ScanStep(kind: card.kind) { scanned in
                    card.code = scanned.value
                    card.format = scanned.format
                    rescanning = false
                } onManual: {
                    rescanning = false
                }
            }
        }
        .onChange(of: logoItem) {
            Task {
                guard let item = logoItem,
                      let data = try? await item.loadTransferable(type: Data.self),
                      let image = UIImage(data: data)
                else { return }
                card.logoData = LogoStore.squareLogo(from: image)
            }
        }
    }

    /// What the card will look like (gift balance from the typed text).
    private var preview: Card {
        var c = card
        if c.name.isEmpty {
            c.name = L("Název obchodu", "Shop name")
        }
        if c.isGift {
            c.balance = parseMoney(balanceText) ?? parseMoney(initialText) ?? 0
        }
        return c
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: { RGB(hex: card.colorHex)?.color ?? Theme.accent },
            set: { newColor in
                var r: CGFloat = 0
                var g: CGFloat = 0
                var b: CGFloat = 0
                var a: CGFloat = 0
                _ = UIColor(newColor).getRed(&r, green: &g, blue: &b, alpha: &a)
                card.colorHex = RGB(r: Double(r), g: Double(g), b: Double(b)).hex
                colorTouched = true
            }
        )
    }

    private func apply(_ brand: Brand) {
        if !colorTouched {
            card.colorHex = brand.color
        }
        card.category = brand.category
    }

    private func save() {
        var c = card
        c.name = c.name.trimmingCharacters(in: .whitespaces)
        c.code = c.code.trimmingCharacters(in: .whitespaces)
        if c.code.isEmpty {
            c.format = .none
        } else if c.format == .none {
            c.format = Barcodes.guess(c.code)
        }
        c.website = cleanDomain(c.website)
        c.expiry = hasExpiry ? expiry : nil
        if c.isGift {
            c.initialBalance = parseMoney(initialText)
            c.balance = parseMoney(balanceText) ?? c.initialBalance ?? 0
            c.stamps = nil
            c.points = nil
            c.pointsGoal = nil
        } else {
            c.balance = nil
            c.initialBalance = nil
            c.pin = ""
            if stampsOn {
                let old = store.card(c.id)?.stamps
                c.stamps = Stamps(goal: stampGoal, count: min(old?.count ?? 0, stampGoal), reward: reward, redeemed: old?.redeemed ?? 0)
            } else {
                c.stamps = nil
            }
            c.points = Int(pointsText.filter(\.isNumber))
            c.pointsGoal = Int(pointsGoalText.filter(\.isNumber))
        }
        if isNew, saveHere, let here = store.location {
            c.places.append(Place(latitude: here.coordinate.latitude, longitude: here.coordinate.longitude))
        }
        store.upsert(c)
        if isNew {
            store.confetti += 1
            store.show(L("Karta uložena", "Card saved"))
            store.open(cardID: c.id)
        } else {
            store.show(L("Uloženo", "Saved"))
            dismiss()
        }
    }
}
