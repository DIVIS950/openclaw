import MapKit
import RaceCore
import SwiftUI

/// Visual language: carbon-black cockpit, high-contrast numerals readable at 200 km/h,
/// green = gaining, red = losing, purple = personal best (motorsport timing convention).
enum Theme {
    static let background = Color(red: 0.04, green: 0.04, blue: 0.05)
    static let surface = Color(red: 0.09, green: 0.09, blue: 0.11)
    static let surfaceHigh = Color(red: 0.14, green: 0.14, blue: 0.17)
    static let stroke = Color.white.opacity(0.08)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.6)
    static let accent = Color(red: 1.0, green: 0.27, blue: 0.0)          // racing orange
    static let gain = Color(red: 0.13, green: 0.87, blue: 0.40)
    static let loss = Color(red: 1.0, green: 0.23, blue: 0.23)
    static let personalBest = Color(red: 0.72, green: 0.35, blue: 1.0)
    static let warning = Color(red: 1.0, green: 0.8, blue: 0.0)

    static func deltaColor(_ d: Double?) -> Color {
        guard let d, d.isFinite else { return textSecondary }
        if abs(d) < 0.02 { return .white }
        return d < 0 ? gain : loss
    }

    static func mono(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }
}

struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Theme.stroke))
    }
}

struct StatTile: View {
    var title: String
    var value: String
    var color: Color = Theme.textPrimary
    var size: CGFloat = 22

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.system(size: 11, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(Theme.mono(size))
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.surfaceHigh, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// Horizontal delta bar: fills left (green) when gaining, right (red) when losing.
struct DeltaBar: View {
    var delta: Double?
    /// Seconds at full scale.
    var range: Double = 1.0

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let d = max(-range, min(range, delta ?? 0))
            let fill = abs(d) / range * (w / 2)
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.surfaceHigh)
                Rectangle()
                    .fill(Theme.deltaColor(delta))
                    .frame(width: fill)
                    .offset(x: d < 0 ? w / 2 - fill : w / 2)
                    .animation(.easeOut(duration: 0.15), value: d)
                Rectangle().fill(Color.white).frame(width: 2).offset(x: w / 2 - 1)
            }
            .clipShape(Capsule())
        }
    }
}

struct PillLabel: View {
    var text: String
    var color: Color
    var systemImage: String?

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage { Image(systemName: systemImage) }
            Text(text)
        }
        .font(.system(size: 12, weight: .semibold))
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .foregroundStyle(color)
        .background(color.opacity(0.15), in: Capsule())
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var color: Color = Theme.accent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 17, weight: .bold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .foregroundStyle(.white)
            .background(color.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

extension GeoPoint {
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
    init(_ c: CLLocationCoordinate2D) { self.init(lat: c.latitude, lon: c.longitude) }
}

extension Gate {
    var polyline: [CLLocationCoordinate2D] {
        let (a, b) = endpoints
        return [a.coordinate, b.coordinate]
    }
}

extension Double {
    var kmh: String { String(format: "%.0f", self * 3.6) }
}
