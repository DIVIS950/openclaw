import Foundation
import Observation

/// The parts of Home (the iPad design) people can add, remove and reorder.
enum HomePart: String, CaseIterable, Identifiable, Hashable {
    case status, weather, gate, alarm, music, favorites, scenes, upcoming, cameras, rooms

    var id: String { rawValue }

    var name: String {
        switch self {
        case .status: "Status bar"
        case .weather: "Weather"
        case .gate: "Gate"
        case .alarm: "Alarm"
        case .music: "Now Playing"
        case .favorites: "Favorites"
        case .scenes: "Scenes"
        case .upcoming: "Coming up"
        case .cameras: "Cameras"
        case .rooms: "Rooms"
        }
    }

    var about: String {
        switch self {
        case .status: "Lights, doors, alarm and gate at a glance"
        case .weather: "Today's weather, sunrise and sunset"
        case .gate: "Slide to open, close and stop"
        case .alarm: "Arm away, arm home or turn off"
        case .music: "What's playing, with play, pause and volume"
        case .favorites: "Your most-used lights, shades and scenes"
        case .scenes: "Whole-house scenes like Good Night"
        case .upcoming: "Next schedules and running timers"
        case .cameras: "Live pictures from your cameras"
        case .rooms: "Every room with its lights, shades and music"
        }
    }

    var symbol: String {
        switch self {
        case .status: "square.grid.2x2"
        case .weather: "cloud.sun.fill"
        case .gate: "door.garage.closed"
        case .alarm: "shield.fill"
        case .music: "music.note"
        case .favorites: "star.fill"
        case .scenes: "sparkles"
        case .upcoming: "clock.fill"
        case .cameras: "video.fill"
        case .rooms: "house.fill"
        }
    }

    /// Widgets that sit next to each other on Home share one row.
    var isWidget: Bool {
        switch self {
        case .weather, .gate, .alarm, .music: true
        default: false
        }
    }
}

/// Kinds of things that can be a favorite. Keys look like "light:l1".
enum FavoriteKind: String {
    case light, shade, media, lock, scene

    func key(_ id: String) -> String { "\(rawValue):\(id)" }
}

/// What this iPad shows on Home, and its favorites. Kept per device (UserDefaults),
/// so the kitchen iPad and the bedroom iPad can differ.
@MainActor
@Observable
final class HomeLayout {
    private(set) var parts: [HomePart]
    private(set) var favorites: [String]

    init() {
        let d = UserDefaults.standard
        let saved = d.stringArray(forKey: Keys.parts)
        parts = saved?.compactMap(HomePart.init(rawValue:)) ?? HomePart.allCases
        favorites = d.stringArray(forKey: Keys.favorites) ?? []
    }

    /// Parts not on Home, in their standard order.
    var hidden: [HomePart] { HomePart.allCases.filter { !parts.contains($0) } }

    func remove(_ part: HomePart) {
        parts.removeAll { $0 == part }
        saveParts()
    }

    func add(_ part: HomePart) {
        guard !parts.contains(part) else { return }
        parts.append(part)
        saveParts()
    }

    /// Moves a part up (-1) or down (+1).
    func move(_ part: HomePart, by step: Int) {
        guard let i = parts.firstIndex(of: part), parts.indices.contains(i + step) else { return }
        parts.swapAt(i, i + step)
        saveParts()
    }

    func reset() {
        parts = HomePart.allCases
        saveParts()
    }

    func isFavorite(_ key: String) -> Bool { favorites.contains(key) }

    /// Adds or removes a favorite. Returns true when it was added.
    @discardableResult
    func toggleFavorite(_ key: String) -> Bool {
        if let i = favorites.firstIndex(of: key) {
            favorites.remove(at: i)
            UserDefaults.standard.set(favorites, forKey: Keys.favorites)
            return false
        }
        favorites.append(key)
        UserDefaults.standard.set(favorites, forKey: Keys.favorites)
        return true
    }

    private func saveParts() {
        UserDefaults.standard.set(parts.map(\.rawValue), forKey: Keys.parts)
    }

    private enum Keys {
        static let parts = "home.layout"
        static let favorites = "home.favorites"
    }
}
