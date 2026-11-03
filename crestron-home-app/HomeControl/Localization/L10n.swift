import Foundation

// The app's language. Strings are written in English in the code and looked up in the
// Czech table (L10nCzech*.swift); Czech is the default because the house is in Czech.
// Same idea as web/public/shared/i18n.js:
//
//   L("Lights")                          -> "Světla"
//   L("{name} on", ["name": light.name]) -> "Strop zapnuto"
//   Ln(3, "{n} light", "{n} lights")     -> "3 světla"  (Czech has 3 plural forms)

enum AppLanguage: String, CaseIterable, Identifiable {
    case cs, en

    var id: String { rawValue }

    /// Always in its own language, so people can find theirs.
    var title: String {
        switch self {
        case .cs: "Čeština"
        case .en: "English"
        }
    }

    var locale: Locale { Locale(identifier: self == .cs ? "cs_CZ" : "en_US") }

    /// For the speech voice.
    var voiceCode: String { self == .cs ? "cs-CZ" : "en-US" }
}

enum L10n {
    /// Set by AppSettings when it loads and when the language is changed in Settings.
    static var language: AppLanguage = .cs

    static var isCzech: Bool { language == .cs }
    static var locale: Locale { language.locale }

    /// English -> Czech. Built once; a key listed twice keeps its first translation.
    static let czech: [String: String] = {
        var pairs: [(String, String)] = []
        pairs.append(contentsOf: csGeneral)
        pairs.append(contentsOf: csHomeView)
        pairs.append(contentsOf: csHeating)
        pairs.append(contentsOf: csSettings)
        pairs.append(contentsOf: csAutomations)
        pairs.append(contentsOf: csAssistant)
        return Dictionary(pairs, uniquingKeysWith: { first, _ in first })
    }()

    /// "one|other" -> [one, few (2–4), many (0, 5+)].
    static let czechPlurals: [String: [String]] = Dictionary(csPlurals, uniquingKeysWith: { first, _ in first })

    static func fill(_ text: String, _ vars: [String: String]) -> String {
        var out = text
        for (key, value) in vars {
            out = out.replacingOccurrences(of: "{\(key)}", with: value)
        }
        return out
    }

    // MARK: Numbers, temperatures and times

    private static let csNumber = makeNumberFormatter("cs_CZ")
    private static let enNumber = makeNumberFormatter("en_US")

    private static func makeNumberFormatter(_ id: String) -> NumberFormatter {
        let f = NumberFormatter()
        f.locale = Locale(identifier: id)
        f.numberStyle = .decimal
        f.minimumFractionDigits = 0
        f.maximumFractionDigits = 1
        f.usesGroupingSeparator = false
        return f
    }

    /// "21,5 °C" (Czech) or "21.5 °C"; "–" when there is no reading.
    static func temp(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "–" }
        let rounded = (value * 10).rounded() / 10
        let formatter = isCzech ? csNumber : enNumber
        let text = formatter.string(from: NSNumber(value: rounded)) ?? String(rounded)
        return "\(text) °C"
    }

    private static let clockFormatter: DateFormatter = {
        let f = DateFormatter()
        // POSIX, so the iPad's 12/24-hour setting can't rewrite the fixed format.
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "H:mm"
        return f
    }()

    private static let clockSecondsFormatter: DateFormatter = {
        let f = DateFormatter()
        // POSIX, so the iPad's 12/24-hour setting can't rewrite the fixed format.
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "H:mm:ss"
        return f
    }()

    /// "23:05": 24-hour time in both languages.
    static func time(_ date: Date) -> String { clockFormatter.string(from: date) }

    /// "23:05:09".
    static func timeWithSeconds(_ date: Date) -> String { clockSecondsFormatter.string(from: date) }

    /// "úterý 3. listopadu" / "Tuesday, November 3".
    static func longDate(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).month(.wide).day().locale(locale))
    }

    /// "úterý" / "Tuesday".
    static func weekday(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).locale(locale))
    }
}

/// The text in the app's language. `en` is the English text, which is also the key.
func L(_ en: String) -> String {
    guard L10n.isCzech, let cs = L10n.czech[en] else { return en }
    return cs
}

/// The text in the app's language with `{name}` style placeholders filled in.
func L(_ en: String, _ vars: [String: String]) -> String {
    L10n.fill(L(en), vars)
}

/// Plural: "{n} light" / "{n} lights". Czech: 1 -> one, 2–4 -> few, 0 and 5+ -> many; the
/// Czech forms live in the plural table under "one|other".
func Ln(_ n: Int, _ one: String, _ other: String, _ vars: [String: String] = [:]) -> String {
    var all = vars
    all["n"] = String(n)
    if L10n.isCzech, let forms = L10n.czechPlurals["\(one)|\(other)"], forms.count == 3 {
        let form = n == 1 ? forms[0] : (n >= 2 && n <= 4 ? forms[1] : forms[2])
        return L10n.fill(form, all)
    }
    return L10n.fill(n == 1 ? one : other, all)
}
