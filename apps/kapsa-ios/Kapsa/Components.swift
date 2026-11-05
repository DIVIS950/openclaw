import SwiftUI
import UIKit

// MARK: - Card pieces

/// The card's bright gradient with a soft shine, like a printed plastic card.
struct CardBackground: View {
    let look: CardLook

    var body: some View {
        ZStack {
            look.gradient
            RadialGradient(
                colors: [.white.opacity(0.38), .clear],
                center: UnitPoint(x: 0.92, y: -0.15),
                startRadius: 0,
                endRadius: 260
            )
        }
    }
}

/// Round logo: the person's own picture, the shop website's icon, or the category icon.
struct LogoView: View {
    let card: Card
    var size: CGFloat = 42
    @Environment(Store.self) private var store

    var body: some View {
        let logos = LogoStore.shared
        ZStack {
            if let data = card.logoData, let own = UIImage(data: data) {
                Image(uiImage: own)
                    .resizable()
                    .scaledToFill()
            } else if store.settings.logos, let icon = logos.images[card.logoDomain] {
                Circle().fill(Color.white)
                Image(uiImage: icon)
                    .resizable()
                    .scaledToFit()
                    .padding(size * 0.16)
            } else {
                Circle().fill(Color.white.opacity(0.26))
                Image(systemName: card.isGift ? "gift" : card.category.symbol)
                    .font(.system(size: size * 0.44, weight: .semibold))
                    .foregroundStyle(card.look.ink)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .shadow(color: .black.opacity(card.logoData == nil ? 0 : 0.12), radius: 4, y: 2)
        .task(id: card.logoDomain) {
            if store.settings.logos {
                await logos.load(card.logoDomain)
            }
        }
    }
}

/// Small glass label on a card ("300 m", "1 coupon").
struct Pill: View {
    let text: String
    var symbol: String?
    var strong = false

    var body: some View {
        HStack(spacing: 4) {
            if let symbol {
                Image(systemName: symbol).font(.caption2.weight(.bold))
            }
            Text(text).font(.caption.weight(.bold)).lineLimit(1)
        }
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background(strong ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.white.opacity(0.26)), in: Capsule())
        .foregroundStyle(strong ? AnyShapeStyle(Theme.warn) : AnyShapeStyle(.primary))
    }
}

/// One card in the wallet stack: everything important sits in its top strip.
struct WalletCardView: View {
    let card: Card
    let distance: Double?
    let coupons: Int
    let isHere: Bool
    @Environment(Store.self) private var store

    var body: some View {
        let look = card.look
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(card.name)
                        .font(.title3.weight(.bold))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.subheadline.weight(.semibold))
                        .opacity(0.92)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                LogoView(card: card)
            }
            HStack(spacing: 6) {
                if card.isGift {
                    Pill(text: L("Dárková karta", "Gift card"), symbol: "gift")
                }
                if let distance {
                    Pill(text: distanceText(distance), symbol: isHere ? "location.fill" : nil)
                }
                if coupons > 0 {
                    Pill(text: "\(coupons)", symbol: "ticket")
                }
                if let expiry = card.expiry, expiry.daysFromToday <= 30 {
                    let days = expiry.daysFromToday
                    Pill(text: days < 0 ? L("prošlá", "expired") : days == 0 ? L("dnes končí", "ends today") : "\(days) d", strong: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 150, maxHeight: 150, alignment: .topLeading)
        .foregroundStyle(look.ink)
        .background(CardBackground(look: look))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(color: look.shadow, radius: 12, y: 8)
        .shadow(color: .black.opacity(0.06), radius: 8, y: -3)
    }

    private var subtitle: String {
        if card.isGift {
            return L("Zbývá \(money(card.balance ?? 0, store.settings.currency))", "\(money(card.balance ?? 0, store.settings.currency)) left")
        }
        if let points = card.points {
            return L("\(points.formatted()) b.", "\(points.formatted()) pts")
        }
        if let s = card.stamps {
            return L("Razítka \(s.count)/\(s.goal)", "Stamps \(s.count)/\(s.goal)")
        }
        if card.sample {
            return L("Ukázka", "Sample")
        }
        return card.category.name
    }
}

/// The white panel with the scannable code and its number.
struct CodePanel: View {
    let code: String
    let format: BarcodeFormat
    var onBig: (() -> Void)?

    var body: some View {
        VStack(spacing: 10) {
            Button {
                onBig?()
            } label: {
                BarcodeView(code: code, format: format)
            }
            .buttonStyle(.plain)
            .disabled(onBig == nil || format == .none)
            HStack {
                Text(Barcodes.grouped(code, format))
                    .font(.system(.body, design: .monospaced).weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Spacer()
                if !code.isEmpty {
                    CopyButton(text: code)
                }
            }
        }
        .padding(16)
        .foregroundStyle(Color(red: 0.16, green: 0.14, blue: 0.25))
        .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 8, y: 4)
    }
}

struct CopyButton: View {
    let text: String
    var label = L("Kopírovat", "Copy")
    @State private var copied = 0

    var body: some View {
        Button {
            UIPasteboard.general.string = text
            copied += 1
        } label: {
            Label(label, systemImage: "doc.on.doc")
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 10)
                .frame(height: 34)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.12)))
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.success, trigger: copied)
    }
}

/// Full-screen white code at full brightness, for the till's scanner.
struct BigCode: Identifiable {
    let id = UUID()
    let code: String
    let format: BarcodeFormat
    let name: String
}

struct BigCodeView: View {
    let big: BigCode
    @Environment(\.dismiss) private var dismiss
    @State private var savedBrightness: CGFloat?

    var body: some View {
        GeometryReader { geo in
            ZStack {
                Color.white.ignoresSafeArea()
                VStack(spacing: 18) {
                    Text(big.name).font(.title2.weight(.bold))
                    if big.format.isLinear && big.format != .pdf417 {
                        // Turned sideways so the bars are as wide as possible.
                        BarcodeView(code: big.code, format: big.format, height: min(geo.size.width * 0.7, 260))
                            .frame(width: geo.size.height * 0.62)
                            .rotationEffect(.degrees(90))
                            .frame(width: geo.size.width, height: geo.size.height * 0.62)
                    } else {
                        BarcodeView(code: big.code, format: big.format, height: 180)
                            .frame(maxWidth: geo.size.width * 0.86)
                    }
                    Text(Barcodes.grouped(big.code, big.format))
                        .font(.system(.title3, design: .monospaced))
                    Text(L("Klepni pro zavření", "Tap to close")).font(.footnote).foregroundStyle(.gray)
                }
                .foregroundStyle(Color(red: 0.16, green: 0.14, blue: 0.25))
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { dismiss() }
        .onAppear {
            if let screen = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.screen {
                savedBrightness = screen.brightness
                screen.brightness = 1
            }
        }
        .onDisappear {
            if let screen = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first?.screen,
               let savedBrightness {
                screen.brightness = savedBrightness
            }
        }
        .statusBarHidden()
    }
}

// MARK: - Buttons and headings

struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 16)
            .background(Theme.grad, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: Theme.accent.opacity(0.35), radius: 10, y: 6)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(Theme.ink)
            .frame(maxWidth: .infinity, minHeight: 50)
            .padding(.horizontal, 16)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Theme.line))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.2), value: configuration.isPressed)
    }
}

/// Glass button on a coloured card.
struct GlassButtonStyle: ButtonStyle {
    var strong = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(strong ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.white.opacity(0.24)), in: Capsule())
            .foregroundStyle(strong ? AnyShapeStyle(Color(red: 0.16, green: 0.14, blue: 0.25)) : AnyShapeStyle(.primary))
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
    }
}

/// Lifts a wallet card a little while it is pressed.
struct LiftButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .offset(y: configuration.isPressed ? -6 : 0)
            .animation(.spring(duration: 0.18), value: configuration.isPressed)
    }
}

struct SectionTitle: View {
    let title: String
    var count: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title).font(.title3.weight(.bold))
            if let count, count > 0 {
                Text("\(count)").font(.title3.weight(.bold)).foregroundStyle(Theme.ink3)
            }
        }
        .foregroundStyle(Theme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// White rounded box for a section's content.
struct Panel<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.line))
        .shadow(color: Color.black.opacity(0.04), radius: 8, y: 3)
    }
}

/// A horizontal row of choice chips.
struct ChipPicker<Value: Hashable>: View {
    let options: [(Value, String)]
    @Binding var selection: Value

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(options.indices, id: \.self) { i in
                    let option = options[i]
                    let on = option.0 == selection
                    Button {
                        selection = option.0
                    } label: {
                        Text(option.1)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14)
                            .frame(height: 36)
                            .background(on ? AnyShapeStyle(Theme.grad) : AnyShapeStyle(Theme.surface), in: Capsule())
                            .overlay(Capsule().stroke(on ? Color.clear : Theme.line))
                            .foregroundStyle(on ? Color.white : Theme.ink)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Confetti

/// A burst of colourful paper when `trigger` changes (full stamp card, saved card).
struct ConfettiView: View {
    let trigger: Int
    @State private var start: Date?
    @State private var pieces: [Piece] = []

    struct Piece {
        let x: Double
        let speed: Double
        let sway: Double
        let spin: Double
        let size: Double
        let color: Color
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: nil, paused: start == nil)) { timeline in
            Canvas { context, size in
                guard let startDate = start else { return }
                let t = timeline.date.timeIntervalSince(startDate)
                for p in pieces {
                    let y = -20 + t * p.speed * size.height / 1.6
                    let x = p.x * size.width + sin(t * 3 + p.sway) * 26
                    let rect = CGRect(x: -p.size / 2, y: -p.size / 4, width: p.size, height: p.size / 2)
                    let transform = CGAffineTransform(translationX: x, y: y).rotated(by: t * p.spin)
                    context.fill(Path(rect).applying(transform), with: .color(p.color))
                }
            }
        }
        .allowsHitTesting(false)
        .onChange(of: trigger) {
            let colors: [Color] = [.orange, .pink, .yellow, .mint, .purple, .blue, Theme.accent]
            pieces = (0..<80).map { _ in
                Piece(
                    x: Double.random(in: 0...1),
                    speed: Double.random(in: 0.7...1.4),
                    sway: Double.random(in: 0...6),
                    spin: Double.random(in: -6...6),
                    size: Double.random(in: 8...14),
                    color: colors.randomElement() ?? .orange
                )
            }
            start = Date()
            Task {
                try? await Task.sleep(for: .seconds(2.4))
                start = nil
            }
        }
    }
}
