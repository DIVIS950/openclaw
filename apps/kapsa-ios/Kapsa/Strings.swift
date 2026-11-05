import Foundation

/// Czech when the phone is set to Czech or Slovak, otherwise English.
enum Lang {
    static let isCzech: Bool = {
        let first = Locale.preferredLanguages.first ?? "en"
        return first.hasPrefix("cs") || first.hasPrefix("sk")
    }()
}

/// One text in both languages: `L("Karty", "Cards")`.
func L(_ czech: String, _ english: String) -> String {
    Lang.isCzech ? czech : english
}
