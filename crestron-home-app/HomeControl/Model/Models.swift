import Foundation

// Plain value types the whole UI is built on. Every backend (demo, Crestron Home
// REST API, custom-program CIP) translates its own data into these.

struct Room: Identifiable, Hashable {
    let id: String
    var name: String
}

struct Light: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// 0...1
    var level: Double
    var isDimmable = true
    var isOnline = true

    var isOn: Bool { level > 0.005 }
}

struct Shade: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// 0 = closed, 1 = fully open.
    var position: Double
    /// False for shades that only have open/close buttons (no position feedback).
    var supportsPosition = true
    var supportsStop = false
    var isOnline = true
}

enum SceneKind: String, Hashable {
    case lighting, shades, media, climate, other
}

struct HomeScene: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    var kind: SceneKind
    var isActive = false
}

struct MediaSource: Identifiable, Hashable {
    let id: String
    var name: String
}

struct MediaZone: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    var isOn: Bool
    /// 0...1
    var volume: Double
    var isMuted: Bool
    var hasVolume = true
    var sources: [MediaSource]
    var currentSourceId: String?

    var currentSource: MediaSource? { sources.first { $0.id == currentSourceId } }
}

struct DoorLock: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// nil when the system gives no feedback.
    var isLocked: Bool?
}

enum SecurityMode: String, Hashable {
    case disarmed, armedHome, armedAway, alarm, unknown

    var title: String {
        switch self {
        case .disarmed: "Disarmed"
        case .armedHome: "Armed Home"
        case .armedAway: "Armed Away"
        case .alarm: "ALARM"
        case .unknown: "Unknown"
        }
    }
}

struct SecurityPanel: Identifiable, Hashable {
    let id: String
    var name: String
    var mode: SecurityMode
    var needsCode = true
    var canArmHome = true
    var canArmAway = true
}

enum GateState: Hashable {
    case open, closed, moving, unknown

    var title: String {
        switch self {
        case .open: "Open"
        case .closed: "Closed"
        case .moving: "Moving"
        case .unknown: "Ready"
        }
    }
}

struct Gate: Identifiable, Hashable {
    let id: String
    var name: String
    var state: GateState
    /// True when there are separate Open and Close commands. Otherwise one
    /// "trigger" pulse toggles the gate (the usual relay setup).
    var hasSeparateOpenClose: Bool
    var canStop: Bool
}

struct HomeSensor: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    var kind: String
    var isActive: Bool
}

struct HomeSnapshot: Hashable {
    var rooms: [Room] = []
    var lights: [Light] = []
    var shades: [Shade] = []
    var scenes: [HomeScene] = []
    var media: [MediaZone] = []
    var locks: [DoorLock] = []
    var security: [SecurityPanel] = []
    var gates: [Gate] = []
    var sensors: [HomeSensor] = []
}

enum GateAction: String {
    case open, close, stop, trigger
}

enum HomeCommand {
    case setLight(id: String, level: Double)
    case setShade(id: String, position: Double)
    case stopShade(id: String)
    case recallScene(id: String)
    case mediaPower(zoneId: String, on: Bool)
    case mediaVolume(zoneId: String, level: Double)
    case mediaMute(zoneId: String, muted: Bool)
    case mediaSource(zoneId: String, sourceId: String)
    case setLock(id: String, locked: Bool)
    case setSecurity(id: String, mode: SecurityMode, code: String?)
    case gate(id: String, action: GateAction)

    /// Key of the control this command changes. The store re-applies recent commands on
    /// top of polled state for a few seconds so a slow processor doesn't make sliders jump
    /// back. Momentary commands (scenes, gate pulses) return nil.
    var stateKey: String? {
        switch self {
        case let .setLight(id, _): "light:\(id)"
        case let .setShade(id, _): "shade:\(id)"
        case let .mediaPower(id, _): "power:\(id)"
        case let .mediaVolume(id, _): "volume:\(id)"
        case let .mediaMute(id, _): "mute:\(id)"
        case let .mediaSource(id, _): "source:\(id)"
        case let .setLock(id, _): "lock:\(id)"
        case let .setSecurity(id, _, _): "security:\(id)"
        case .stopShade, .recallScene, .gate: nil
        }
    }
}

extension HomeSnapshot {
    /// Optimistic local update: show what the user asked for right away, before the
    /// processor confirms. The demo backend also uses this as its whole "engine".
    mutating func apply(_ command: HomeCommand) {
        switch command {
        case let .setLight(id, level):
            if let i = lights.firstIndex(where: { $0.id == id }) { lights[i].level = level.clamped01 }
        case let .setShade(id, position):
            if let i = shades.firstIndex(where: { $0.id == id }) { shades[i].position = position.clamped01 }
        case .stopShade:
            break
        case let .recallScene(id):
            if let i = scenes.firstIndex(where: { $0.id == id }) { scenes[i].isActive = true }
        case let .mediaPower(id, on):
            if let i = media.firstIndex(where: { $0.id == id }) { media[i].isOn = on }
        case let .mediaVolume(id, level):
            if let i = media.firstIndex(where: { $0.id == id }) { media[i].volume = level.clamped01 }
        case let .mediaMute(id, muted):
            if let i = media.firstIndex(where: { $0.id == id }) { media[i].isMuted = muted }
        case let .mediaSource(id, sourceId):
            if let i = media.firstIndex(where: { $0.id == id }) {
                media[i].currentSourceId = sourceId
                media[i].isOn = true
            }
        case let .setLock(id, locked):
            if let i = locks.firstIndex(where: { $0.id == id }) { locks[i].isLocked = locked }
        case let .setSecurity(id, mode, _):
            if let i = security.firstIndex(where: { $0.id == id }) { security[i].mode = mode }
        case let .gate(id, action):
            if let i = gates.firstIndex(where: { $0.id == id }) {
                gates[i].state = action == .stop ? .unknown : .moving
            }
        }
    }

    func room(_ id: String?) -> Room? {
        guard let id else { return nil }
        return rooms.first { $0.id == id }
    }

    /// The room id if that room exists, else nil (devices assigned to rooms we don't know).
    func knownRoomId(_ id: String?) -> String? { room(id)?.id }

    func lights(in roomId: String) -> [Light] { lights.filter { $0.roomId == roomId } }
    func shades(in roomId: String) -> [Shade] { shades.filter { $0.roomId == roomId } }
    func scenes(in roomId: String) -> [HomeScene] { scenes.filter { $0.roomId == roomId } }
    func media(in roomId: String) -> [MediaZone] { media.filter { $0.roomId == roomId } }
    func locks(in roomId: String) -> [DoorLock] { locks.filter { $0.roomId == roomId } }

    /// Scenes for the whole house (no room), falling back to everything if the
    /// system assigns every scene to a room.
    var homeScenes: [HomeScene] {
        let global = scenes.filter { $0.roomId == nil || room($0.roomId) == nil }
        return global.isEmpty ? Array(scenes.prefix(8)) : global
    }

    var lightsOnCount: Int { lights.filter(\.isOn).count }
    var unlockedCount: Int { locks.filter { $0.isLocked == false }.count }
}

extension Double {
    var clamped01: Double { Swift.min(1, Swift.max(0, self)) }
    var percentText: String { "\(Int((self * 100).rounded()))%" }
}
