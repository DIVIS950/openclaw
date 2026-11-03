import Observation
import SwiftUI
import UIKit

// Home View: the iPad design. A floating glass sidebar beside one scrolling column,
// over a soft wallpaper whose colors follow the time of day (home) or the room.
// Tiles follow Apple Home: frosted when off, solid white when on.

/// Where the content column is, which sheet is open, and the little notices at the top.
@MainActor
@Observable
final class HVNav {
    enum Route: Hashable {
        case home, lights, heating, shades, media, security, cameras, automations
        case room(String)
    }

    enum Sheet: Identifiable, Hashable {
        case light(String), shade(String), media(String), lock(String), gate(String)
        case climate(String), homeSwitch(String)
        case camera(UUID)
        case keypad(panelId: String, mode: SecurityMode)
        case confirmGate(String, GateAction)
        case settings
        case editHome, favorites
        case schedule(HomeSchedule)

        var id: String {
            switch self {
            case let .light(id): "light:\(id)"
            case let .shade(id): "shade:\(id)"
            case let .media(id): "media:\(id)"
            case let .lock(id): "lock:\(id)"
            case let .gate(id): "gate:\(id)"
            case let .climate(id): "climate:\(id)"
            case let .homeSwitch(id): "switch:\(id)"
            case let .camera(id): "camera:\(id)"
            case let .keypad(id, mode): "keypad:\(id):\(mode.rawValue)"
            case let .confirmGate(id, action): "confirm:\(id):\(action.rawValue)"
            case .settings: "settings"
            case .editHome: "edit-home"
            case .favorites: "favorites"
            case let .schedule(draft): "schedule:\(draft.id)"
            }
        }

        /// Longer cards that scroll: shown at the standard sheet size, not fitted to content.
        var isList: Bool {
            switch self {
            case .editHome, .favorites, .schedule: true
            default: false
            }
        }
    }

    /// The doorbell pop-up: which doorbell, and the ring it is showing.
    struct DoorbellAlert: Equatable {
        let id: String
        let ringAt: Date
    }

    struct Notice: Identifiable, Equatable {
        let id = UUID()
        var text: String
        var symbol: String
        var color: Color
    }

    /// A wash of color spreading over the screen from where a scene was started.
    struct Ripple: Identifiable, Equatable {
        let id = UUID()
        /// In global (screen) coordinates.
        var center: CGPoint
        var color: Color
    }

    var route: Route = .home
    var sheet: Sheet?
    var notice: Notice?
    var askOpen = false
    var sidebarOpen = false
    var cameraWall = false
    var doorbell: DoorbellAlert?
    var ripple: Ripple?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var rippleTask: Task<Void, Never>?

    func go(_ route: Route) {
        withAnimation(.easeOut(duration: 0.25)) {
            self.route = route
            sidebarOpen = false
        }
    }

    func showRipple(at center: CGPoint, color: Color) {
        ripple = Ripple(center: center, color: color)
        rippleTask?.cancel()
        rippleTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.1))
            guard !Task.isCancelled else { return }
            self?.ripple = nil
        }
    }

    func notify(_ text: String, symbol: String = "checkmark", color: Color = .green, seconds: Double = 2.4) {
        withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { notice = Notice(text: text, symbol: symbol, color: color) }
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.25)) { self?.notice = nil }
        }
    }
}

enum HV {
    // Colors per kind of device, Apple's system colors so they adapt to light and dark.
    /// Amber rather than system yellow, so a white bulb on it stays readable.
    static let light = Color(red: 1.0, green: 0.70, blue: 0.0)
    static let shade = Color.cyan
    static let media = Color.purple
    static let gate = Color.blue
    static let camera = Color.pink

    static let sceneColors: [Color] = [.orange, .indigo, .blue, .pink, .purple, .teal, .green, .yellow]

    static let tileRadius: CGFloat = 22
    static let widgetRadius: CGFloat = 28

    static func alarmColor(_ mode: SecurityMode) -> Color {
        switch mode {
        case .disarmed, .unknown: .gray
        case .armedHome: .indigo
        case .armedAway: .blue
        case .alarm: .red
        }
    }

    // Wallpaper hues (degrees): two corners and the glow along the bottom.
    private static let roomHues: [[Double]] = [
        [24, 345, 44], [46, 150, 92], [8, 318, 276], [262, 220, 322],
        [198, 168, 234], [128, 62, 186], [34, 200, 12], [290, 332, 200],
    ]

    static func hues(for route: HVNav.Route, home: HomeSnapshot, date: Date) -> [Double] {
        if case let .room(id) = route, let index = home.rooms.firstIndex(where: { $0.id == id }) {
            return roomHues[index % roomHues.count]
        }
        let hour = Double(Calendar.current.component(.hour, from: date)) + Double(Calendar.current.component(.minute, from: date)) / 60
        switch hour {
        case 5..<8.5: return [24, 336, 205] // dawn
        case 8.5..<17: return [204, 176, 40] // day
        case 17..<20.5: return [22, 300, 252] // dusk
        default: return [232, 268, 196] // night
        }
    }

    /// The room's two wallpaper hues (degrees), also used for its card when it has no photo.
    static func roomHuePalette(_ home: HomeSnapshot, _ roomId: String) -> [Double] {
        let index = max(0, home.rooms.firstIndex { $0.id == roomId } ?? 0)
        return roomHues[index % roomHues.count]
    }

    static func roomColor(_ home: HomeSnapshot, _ roomId: String) -> Color {
        let index = max(0, home.rooms.firstIndex { $0.id == roomId } ?? 0)
        return hsl(roomHues[index % roomHues.count][0], 0.78, 0.54)
    }

    /// HSL in, SwiftUI color out (SwiftUI only takes HSB).
    static func hsl(_ hue: Double, _ saturation: Double, _ lightness: Double, opacity: Double = 1) -> Color {
        let value = lightness + saturation * min(lightness, 1 - lightness)
        let sat = value == 0 ? 0 : 2 * (1 - lightness / value)
        return Color(hue: hue.truncatingRemainder(dividingBy: 360) / 360, saturation: sat, brightness: value, opacity: opacity)
    }

    static func symbol(for zone: MediaZone) -> String {
        let text = (zone.currentSource?.name ?? zone.name).lowercased()
        return ["tv", "cable", "apple"].contains { text.contains($0) } ? "tv" : "hifispeaker.fill"
    }
}

/// Big, slowly drifting color fields. Lighter by day, deep at night (dark appearance).
@MainActor
struct HVWallpaper: View {
    let hues: [Double]
    var photo: UIImage?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        let dark = scheme == .dark
        let sat = dark ? 0.58 : 0.92
        GeometryReader { geo in
            let side = max(geo.size.width, geo.size.height)
            ZStack {
                HV.hsl(hues[0], sat, dark ? 0.09 : 0.93)
                blob(HV.hsl(hues[0], sat, dark ? 0.30 : 0.80), size: side * 0.95)
                    .position(x: side * (drift ? 0.2 : 0.12), y: side * (drift ? 0.1 : 0.04))
                blob(HV.hsl(hues[1], sat, dark ? 0.24 : 0.76), size: side * 0.8)
                    .position(x: geo.size.width - side * (drift ? 0.2 : 0.1), y: side * (drift ? 0.18 : 0.12))
                blob(HV.hsl(hues[2], sat, dark ? 0.20 : 0.84), size: side * 0.9)
                    .position(x: geo.size.width * (drift ? 0.45 : 0.55), y: geo.size.height + side * (drift ? 0.02 : 0.08))
                if let photo {
                    // A room photo, softened so tiles stay readable on top of it.
                    Image(uiImage: photo).resizable().scaledToFill()
                        .frame(width: geo.size.width, height: geo.size.height).clipped()
                        .blur(radius: 18)
                        .overlay((dark ? Color.black : Color.white).opacity(dark ? 0.45 : 0.35))
                }
            }
            .animation(.easeInOut(duration: 1.2), value: hues)
        }
        .ignoresSafeArea()
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 48).repeatForever(autoreverses: true)) { drift = true }
        }
    }

    private func blob(_ color: Color, size: CGFloat) -> some View {
        Circle()
            .fill(RadialGradient(colors: [color, color.opacity(0)], center: .center, startRadius: 0, endRadius: size / 2))
            .frame(width: size, height: size)
    }
}

/// Frosted panel with a hairline edge, used for the sidebar, tiles that are off, and widgets.
struct HVGlass: ViewModifier {
    var radius: CGFloat
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(.ultraThinMaterial, in: shape)
            .overlay(shape.strokeBorder(.white.opacity(scheme == .dark ? 0.12 : 0.65), lineWidth: 0.5))
            .shadow(color: .black.opacity(scheme == .dark ? 0.25 : 0.07), radius: 14, y: 8)
    }
}

extension View {
    func hvGlass(_ radius: CGFloat = HV.tileRadius) -> some View { modifier(HVGlass(radius: radius)) }

    /// Sheets size to their content where the system allows it (iPadOS 18+).
    @ViewBuilder
    func hvSheetSizing() -> some View {
        if #available(iOS 18.0, *) {
            presentationSizing(.fitted)
        } else {
            self
        }
    }
}

/// Slight shrink on press, with a springy release.
struct HVPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.965 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/// The colorful ring used for Ask Home.
struct HVOrb: View {
    var size: CGFloat = 28
    @State private var spin = false

    var body: some View {
        Circle()
            .fill(AngularGradient(colors: [.pink, .orange, .yellow, .cyan, .indigo, .purple, .pink], center: .center))
            .overlay(Circle().fill(RadialGradient(colors: [.white, .white.opacity(0.5), .clear], center: UnitPoint(x: 0.4, y: 0.35), startRadius: 0, endRadius: size * 0.4)).padding(size * 0.18))
            .frame(width: size, height: size)
            .rotationEffect(.degrees(spin ? 360 : 0))
            .shadow(color: .purple.opacity(0.5), radius: 7)
            .onAppear { withAnimation(.linear(duration: 7).repeatForever(autoreverses: false)) { spin = true } }
            .accessibilityHidden(true)
    }
}

/// The time, 24-hour, like the Lock Screen.
struct HVClock: View {
    var size: CGFloat = 64

    var body: some View {
        TimelineView(.everyMinute) { context in
            let parts = L10n.time(context.date).split(whereSeparator: \.isWhitespace)
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(String(parts.first ?? ""))
                    .font(.system(size: size, weight: .light))
                    .monospacedDigit()
                if parts.count > 1 {
                    Text(parts.dropFirst().joined(separator: " "))
                        .font(.system(size: size * 0.32, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
            }
            .tracking(-1)
        }
    }
}
