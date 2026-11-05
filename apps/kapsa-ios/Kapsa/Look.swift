import SwiftUI
import UIKit

// How a card looks in the wallet: a bright gradient made from its colour, text that
// stays readable on it, and a soft coloured shadow. Black, grey and very dark shop
// colours are swapped for a bright colour of the category, so the wallet never turns black.

struct RGB: Hashable, Sendable {
    var r: Double
    var g: Double
    var b: Double

    init(r: Double, g: Double, b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// "#RRGGBB" (or "RRGGBB"); nil when it isn't one.
    init?(hex: String) {
        let s = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard s.count == 6, let n = UInt32(s, radix: 16) else { return nil }
        r = Double((n >> 16) & 0xFF) / 255
        g = Double((n >> 8) & 0xFF) / 255
        b = Double(n & 0xFF) / 255
    }

    var hex: String {
        let v = [r, g, b].map { Int(($0 * 255).rounded()).clamped(0, 255) }
        return String(format: "#%02X%02X%02X", v[0], v[1], v[2])
    }

    var color: Color { Color(red: r, green: g, blue: b) }

    /// Relative luminance (0 black ... 1 white).
    var luminance: Double {
        func ch(_ c: Double) -> Double { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
    }

    /// Hue (degrees), saturation and lightness (0...1).
    var hsl: (h: Double, s: Double, l: Double) {
        let maxV = max(r, g, b)
        let minV = min(r, g, b)
        let l = (maxV + minV) / 2
        guard maxV != minV else { return (0, 0, l) }
        let d = maxV - minV
        let s = l > 0.5 ? d / (2 - maxV - minV) : d / (maxV + minV)
        var h: Double
        if maxV == r {
            h = (g - b) / d + (g < b ? 6 : 0)
        } else if maxV == g {
            h = (b - r) / d + 2
        } else {
            h = (r - g) / d + 4
        }
        h *= 60
        return (h, s, l)
    }

    init(h: Double, s: Double, l: Double) {
        let hue = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        let sat = min(1, max(0, s))
        let a = sat * min(l, 1 - l)
        func f(_ n: Double) -> Double {
            let k = (n + hue / 30).truncatingRemainder(dividingBy: 12)
            return min(1, max(0, l - a * max(-1, min(k - 3, 9 - k, 1))))
        }
        self.init(r: f(0), g: f(8), b: f(4))
    }

    func mixed(with other: RGB) -> RGB {
        RGB(r: (r + other.r) / 2, g: (g + other.g) / 2, b: (b + other.b) / 2)
    }
}

extension Comparable {
    func clamped(_ low: Self, _ high: Self) -> Self { min(max(self, low), high) }
}

/// The colours of one card.
struct CardLook: Sendable {
    let from: RGB
    let to: RGB
    let lightCard: Bool

    var gradient: LinearGradient {
        LinearGradient(colors: [from.color, to.color], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    /// Text on the card: white, or warm dark brown on light cards (never black).
    var ink: Color { lightCard ? Theme.darkInk : .white }
    var shadow: Color { to.color.opacity(0.35) }
    /// A single colour for small dots and pins.
    var dot: Color { to.color }
}

enum Looks {
    /// Bright two-stop gradients per category (light end first).
    static let palette: [ShopCategory: (String, String)] = [
        .bakery: ("#FFB347", "#FF6B6B"),
        .grocery: ("#3DD68C", "#0E9F6E"),
        .coffee: ("#E0A16B", "#B5523B"),
        .food: ("#FF9966", "#FF5E62"),
        .pharmacy: ("#4FD1C5", "#0F9B8E"),
        .beauty: ("#FF9AC8", "#E0457B"),
        .fashion: ("#B79CFF", "#7B5CFF"),
        .sport: ("#6FB1FF", "#3D6BFF"),
        .fuel: ("#FFD86B", "#FFA62B"),
        .home: ("#FFC27A", "#FF8A3D"),
        .electronics: ("#5ED0FF", "#2E8CFF"),
        .other: ("#9FA8FF", "#6C63FF"),
    ]
    static let gift = ("#FF9A8B", "#FF5C8A")

    static func look(colorHex: String, category: ShopCategory, kind: CardKind) -> CardLook {
        let base = RGB(hex: colorHex)
        let from: RGB
        let to: RGB
        if let base, base.hsl.l >= 0.2, !(base.hsl.s < 0.15 && base.hsl.l < 0.7) {
            let hsl = base.hsl
            if hsl.l > 0.82 {
                // Pale cards (cream, light blue) stay pale with dark text.
                from = RGB(h: hsl.h, s: hsl.s, l: min(0.95, hsl.l + 0.06))
                to = base
            } else {
                // Lift dark brand colours a little and add a light end for the gradient.
                let l = min(0.58, max(hsl.l, 0.36))
                let s = max(hsl.s, 0.55)
                from = RGB(h: hsl.h - 8, s: s, l: min(0.76, l + 0.15))
                to = RGB(h: hsl.h + 4, s: s, l: l)
            }
        } else {
            // Black, near-black or grey: a bright colour that fits the shop.
            let pair = kind == .gift ? gift : (palette[category] ?? ("#9FA8FF", "#6C63FF"))
            from = RGB(hex: pair.0) ?? RGB(r: 1, g: 0.7, b: 0.3)
            to = RGB(hex: pair.1) ?? RGB(r: 1, g: 0.4, b: 0.4)
        }
        return CardLook(from: from, to: to, lightCard: from.mixed(with: to).luminance > 0.42)
    }
}

extension Card {
    var look: CardLook { Looks.look(colorHex: colorHex, category: category, kind: kind) }
}

/// App colours: warm cream page, deep plum text, one orange-to-coral accent.
enum Theme {
    static let bg = dynamic(light: "#FBF7F1", dark: "#1D1A26")
    static let surface = dynamic(light: "#FFFFFF", dark: "#282434")
    static let surface2 = dynamic(light: "#F5EEE5", dark: "#332E41")
    static let ink = dynamic(light: "#2A2440", dark: "#F4EFFA")
    static let ink2 = dynamic(light: "#5D5672", dark: "#C3BBD3")
    static let ink3 = dynamic(light: "#958EA8", dark: "#8F87A3")
    static let line = dynamic(light: "#EEE5DA", dark: "#3A3449")
    static let accent = Color(red: 1, green: 0.42, blue: 0.37)
    static let warn = Color(red: 0.72, green: 0.38, blue: 0)
    static let darkInk = Color(red: 0.23, green: 0.16, blue: 0.08)
    static var grad: LinearGradient {
        LinearGradient(
            colors: [Color(red: 1, green: 0.70, blue: 0.28), Color(red: 1, green: 0.42, blue: 0.42)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }

    private static func dynamic(light: String, dark: String) -> Color {
        let l = RGB(hex: light) ?? RGB(r: 1, g: 1, b: 1)
        let d = RGB(hex: dark) ?? RGB(r: 0, g: 0, b: 0)
        return Color(uiColor: UIColor { traits in
            let c = traits.userInterfaceStyle == .dark ? d : l
            return UIColor(red: c.r, green: c.g, blue: c.b, alpha: 1)
        })
    }
}
