import SwiftUI

/// Dark, glassy look in the spirit of the new Crestron Home interface: big room
/// cards, soft gradients, one accent color per kind of device.
enum Theme {
    static let backgroundTop = Color(red: 0.05, green: 0.06, blue: 0.09)
    static let backgroundBottom = Color(red: 0.09, green: 0.10, blue: 0.15)
    static let background = LinearGradient(colors: [backgroundTop, backgroundBottom], startPoint: .top, endPoint: .bottom)

    static let light = Color(red: 1.00, green: 0.77, blue: 0.35)
    static let shade = Color(red: 0.50, green: 0.73, blue: 1.00)
    static let media = Color(red: 0.74, green: 0.55, blue: 1.00)
    static let secure = Color(red: 0.33, green: 0.85, blue: 0.60)
    static let alert = Color(red: 1.00, green: 0.38, blue: 0.40)
    static let gate = Color(red: 0.36, green: 0.84, blue: 0.90)
    static let scene = Color(red: 1.00, green: 0.58, blue: 0.42)

    static let corner: CGFloat = 24
    static let smallCorner: CGFloat = 16

    private static let roomPalettes: [[Color]] = [
        [Color(red: 0.36, green: 0.27, blue: 0.62), Color(red: 0.15, green: 0.12, blue: 0.32)],
        [Color(red: 0.12, green: 0.42, blue: 0.55), Color(red: 0.06, green: 0.17, blue: 0.27)],
        [Color(red: 0.62, green: 0.34, blue: 0.20), Color(red: 0.27, green: 0.13, blue: 0.10)],
        [Color(red: 0.18, green: 0.48, blue: 0.36), Color(red: 0.07, green: 0.20, blue: 0.16)],
        [Color(red: 0.55, green: 0.22, blue: 0.40), Color(red: 0.24, green: 0.09, blue: 0.19)],
        [Color(red: 0.30, green: 0.36, blue: 0.55), Color(red: 0.12, green: 0.14, blue: 0.26)],
    ]

    /// Stable gradient per room so cards keep their color between launches.
    static func roomGradient(_ name: String) -> LinearGradient {
        let hash = name.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFF }
        let colors = roomPalettes[hash % roomPalettes.count]
        return LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }

    static func roomSymbol(_ name: String) -> String {
        let n = name.lowercased()
        let table: [(String, String)] = [
            ("kitchen", "fork.knife"), ("dining", "wineglass"), ("living", "sofa"), ("family", "sofa"),
            ("bed", "bed.double"), ("master", "bed.double"), ("kid", "teddybear"), ("office", "desktopcomputer"),
            ("study", "books.vertical"), ("bath", "bathtub"), ("patio", "sun.max"), ("garden", "leaf"),
            ("pool", "figure.pool.swim"), ("garage", "car"), ("entry", "door.left.hand.open"), ("foyer", "door.left.hand.open"),
            ("theater", "film"), ("cinema", "film"), ("media", "tv"), ("gym", "dumbbell"), ("wine", "wineglass"),
            ("hall", "figure.walk"), ("laundry", "washer"), ("guest", "person.2"), ("outdoor", "tree"),
            // Czech room names.
            ("obýv", "sofa"), ("kuchy", "fork.knife"), ("jídel", "wineglass"), ("knihov", "books.vertical"),
            ("zádveří", "door.left.hand.open"), ("předsíň", "door.left.hand.open"), ("chodb", "figure.walk"),
            ("ložnic", "bed.double"), ("dětsk", "teddybear"), ("pokoj", "person.2"), ("koupel", "bathtub"),
            ("pracovn", "desktopcomputer"), ("kancel", "desktopcomputer"), ("klub", "film"), ("kino", "film"),
            ("sauna", "flame"), ("fitk", "dumbbell"), ("posilov", "dumbbell"), ("bazén", "figure.pool.swim"),
            ("zahrad", "leaf"), ("teras", "sun.max"), ("garáž", "car"), ("sklep", "archivebox"), ("prádel", "washer"),
        ]
        return table.first { n.contains($0.0) }?.1 ?? "square.split.2x2"
    }

    static func sceneSymbol(_ scene: HomeScene) -> String {
        let n = scene.name.lowercased()
        // English and Czech scene names.
        let has = { (words: [String]) in words.contains { n.contains($0) } }
        if has(["night", "sleep", "noc", "spánek"]) { return "moon.stars.fill" }
        if has(["morning", "wake", "ráno", "budíček"]) { return "sunrise.fill" }
        if has(["away", "leave", "odchod", "odjezd"]) { return "figure.walk.departure" }
        if has(["welcome", "home", "arrive", "příjezd", "vítej", "domů"]) { return "house.fill" }
        if has(["movie", "tv", "cinema", "televize", "kino", "film"]) { return "film.fill" }
        if has(["dinner", "cook", "večeře", "oběd", "vaření"]) { return "fork.knife" }
        if has(["read", "čtení"]) { return "book.fill" }
        if has(["party", "entertain", "oslava"]) { return "party.popper.fill" }
        if has(["off", "vypnout", "vypnuto"]) { return "power" }
        switch scene.kind {
        case .lighting: return "lightbulb.fill"
        case .shades: return "blinds.horizontal.closed"
        case .media: return "play.tv.fill"
        case .climate: return "thermometer.medium"
        case .other: return "sparkles"
        }
    }
}

struct CardBackground: ViewModifier {
    var padding: CGFloat = 16

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
                    .strokeBorder(.white.opacity(0.07))
            )
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardBackground(padding: padding)) }

    /// Shared screen chrome: dark gradient behind scrollable content.
    func screenBackground() -> some View {
        background(Theme.background.ignoresSafeArea())
            .scrollContentBackground(.hidden)
    }
}

@MainActor
struct SectionHeader: View {
    let title: String
    var trailing: String?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.title3.weight(.semibold))
            Spacer()
            if let trailing {
                Text(trailing).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 4)
    }
}
