import Foundation

/// A well-known chain: its colour, category and website (for the logo).
struct Brand: Hashable, Sendable {
    let name: String
    let domain: String
    let color: String
    let category: ShopCategory
    var aliases: [String] = []
}

enum Brands {
    static let all: [Brand] = [
        Brand(name: "Bageterie Boulevard", domain: "bb.cz", color: "#1E1E1E", category: .bakery),
        Brand(name: "Paul", domain: "paul.fr", color: "#2B2A29", category: .bakery),
        Brand(name: "Ugo", domain: "ugo.cz", color: "#E4007C", category: .food, aliases: ["Ugo Fresh"]),
        Brand(name: "Albert", domain: "albert.cz", color: "#003C8F", category: .grocery, aliases: ["Albert Supermarket", "Albert Hypermarket"]),
        Brand(name: "Billa", domain: "billa.cz", color: "#FFE500", category: .grocery),
        Brand(name: "Lidl", domain: "lidl.cz", color: "#0050AA", category: .grocery),
        Brand(name: "Kaufland", domain: "kaufland.cz", color: "#E10915", category: .grocery),
        Brand(name: "Tesco", domain: "itesco.cz", color: "#00539F", category: .grocery, aliases: ["Tesco Express", "Tesco Extra"]),
        Brand(name: "Penny", domain: "penny.cz", color: "#CD1414", category: .grocery, aliases: ["Penny Market"]),
        Brand(name: "Globus", domain: "globus.cz", color: "#007A3D", category: .grocery),
        Brand(name: "Coop", domain: "coop.cz", color: "#00843D", category: .grocery, aliases: ["COOP Tuty", "COOP Jednota"]),
        Brand(name: "Žabka", domain: "zabka.cz", color: "#2C8B39", category: .grocery, aliases: ["Zabka"]),
        Brand(name: "Rohlík", domain: "rohlik.cz", color: "#5BA829", category: .grocery, aliases: ["Rohlik"]),
        Brand(name: "Starbucks", domain: "starbucks.com", color: "#00704A", category: .coffee),
        Brand(name: "Costa Coffee", domain: "costa.co.uk", color: "#6D1F37", category: .coffee),
        Brand(name: "Café Café", domain: "cafecafe.cz", color: "#3B2418", category: .coffee, aliases: ["Cafe Cafe"]),
        Brand(name: "McDonald's", domain: "mcdonalds.cz", color: "#DA291C", category: .food),
        Brand(name: "KFC", domain: "kfc.cz", color: "#A3080C", category: .food),
        Brand(name: "Burger King", domain: "burgerking.cz", color: "#D62300", category: .food),
        Brand(name: "dm", domain: "dm.cz", color: "#1D3A8A", category: .beauty, aliases: ["dm drogerie markt"]),
        Brand(name: "Rossmann", domain: "rossmann.cz", color: "#C3002F", category: .beauty),
        Brand(name: "Teta", domain: "tetadrogerie.cz", color: "#E2007A", category: .beauty, aliases: ["Teta drogerie"]),
        Brand(name: "Notino", domain: "notino.cz", color: "#111111", category: .beauty),
        Brand(name: "Sephora", domain: "sephora.cz", color: "#101010", category: .beauty),
        Brand(name: "Douglas", domain: "douglas.cz", color: "#9BDCD2", category: .beauty),
        Brand(name: "Dr.Max", domain: "drmax.cz", color: "#00315F", category: .pharmacy, aliases: ["Dr. Max", "Lékárna Dr.Max"]),
        Brand(name: "Benu", domain: "benu.cz", color: "#00A651", category: .pharmacy, aliases: ["BENU Lékárna"]),
        Brand(name: "Pilulka", domain: "pilulka.cz", color: "#E5007D", category: .pharmacy),
        Brand(name: "H&M", domain: "hm.com", color: "#E50010", category: .fashion),
        Brand(name: "Reserved", domain: "reserved.com", color: "#1A1A1A", category: .fashion),
        Brand(name: "Pepco", domain: "pepco.cz", color: "#0047BB", category: .fashion),
        Brand(name: "Deichmann", domain: "deichmann.com", color: "#00843D", category: .fashion),
        Brand(name: "CCC", domain: "ccc.eu", color: "#B4121B", category: .fashion),
        Brand(name: "Tchibo", domain: "tchibo.cz", color: "#1D2C4C", category: .home),
        Brand(name: "Decathlon", domain: "decathlon.cz", color: "#0082C3", category: .sport),
        Brand(name: "Sportisimo", domain: "sportisimo.cz", color: "#E30613", category: .sport),
        Brand(name: "Hervis", domain: "hervis.cz", color: "#D4001A", category: .sport),
        Brand(name: "IKEA", domain: "ikea.com", color: "#0058A3", category: .home),
        Brand(name: "Hornbach", domain: "hornbach.cz", color: "#F7931E", category: .home),
        Brand(name: "OBI", domain: "obi.cz", color: "#FF7E21", category: .home),
        Brand(name: "Bauhaus", domain: "bauhaus.cz", color: "#DA2128", category: .home),
        Brand(name: "JYSK", domain: "jysk.cz", color: "#143C8A", category: .home),
        Brand(name: "Action", domain: "action.com", color: "#004B93", category: .home),
        Brand(name: "Datart", domain: "datart.cz", color: "#E2001A", category: .electronics),
        Brand(name: "Alza", domain: "alza.cz", color: "#21A9E1", category: .electronics, aliases: ["AlzaBox"]),
        Brand(name: "Electro World", domain: "electroworld.cz", color: "#00A0E3", category: .electronics),
        Brand(name: "Shell", domain: "shell.cz", color: "#FFD500", category: .fuel),
        Brand(name: "OMV", domain: "omv.cz", color: "#0A3C78", category: .fuel),
        Brand(name: "MOL", domain: "molcesko.cz", color: "#E30613", category: .fuel),
        Brand(name: "Orlen", domain: "orlen.cz", color: "#E3000F", category: .fuel, aliases: ["Benzina"]),
    ]

    /// Lowercase, no accents or punctuation: "Lékárna Dr.Max" -> "lekarna dr max".
    static func normalize(_ value: String) -> String {
        let folded = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en"))
        let replaced = folded.replacingOccurrences(of: "&", with: " and ")
        let parts = replaced.split(whereSeparator: { !$0.isLetter && !$0.isNumber })
        return parts.joined(separator: " ")
    }

    /// The chain a typed name refers to (exact name or alias).
    static func find(_ name: String) -> Brand? {
        let n = normalize(name)
        guard !n.isEmpty else { return nil }
        return all.first { brand in ([brand.name] + brand.aliases).contains { normalize($0) == n } }
    }

    /// Chains whose name starts with what was typed, best first.
    static func suggest(_ query: String, limit: Int = 6) -> [Brand] {
        let q = normalize(query)
        guard !q.isEmpty else { return [] }
        var starts: [Brand] = []
        var words: [Brand] = []
        for brand in all {
            let names = ([brand.name] + brand.aliases).map(normalize)
            if names.contains(q) { continue }
            if names.contains(where: { $0.hasPrefix(q) }) {
                starts.append(brand)
            } else if names.contains(where: { $0.split(separator: " ").contains { $0.hasPrefix(q) } }) {
                words.append(brand)
            }
        }
        return Array((starts + words).prefix(limit))
    }

    /// Bright colours offered for cards without a known chain.
    static let swatches = [
        "#FF6B6B", "#FF9F43", "#FFC93C", "#2FCB86", "#14B8A6", "#3D9BFF",
        "#3D6BFF", "#7B5CFF", "#C04DE0", "#E0457B", "#C9875A", "#E6E1D6",
    ]
}

extension Card {
    /// Website for the logo: the one saved on the card, else the known chain's.
    var logoDomain: String {
        let own = cleanDomain(website)
        return own.isEmpty ? (Brands.find(name)?.domain ?? "") : own
    }
}
