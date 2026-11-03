import Foundation

// Plain value types the whole UI is built on. Every backend (demo, Crestron Home
// REST API, custom-program CIP) translates its own data into these.

struct Room: Identifiable, Hashable {
    let id: String
    var name: String
    /// Floor name like "1.NP", used to group rooms. nil when the system has no floors.
    var floor: String? = nil
    /// Which system it comes from: "crestron", "homekit", "samsungtv" or "demo".
    var origin: String? = nil
}

struct Light: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// 0...1
    var level: Double
    var isDimmable = true
    var isOnline = true
    /// Which system it comes from: "crestron", "homekit", "samsungtv" or "demo".
    var origin: String? = nil

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
    var origin: String? = nil
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
    var origin: String? = nil
}

struct MediaSource: Identifiable, Hashable {
    let id: String
    var name: String
}

/// An app a TV can open (Netflix, YouTube…). `id` is what the TV wants (tvApp.appId).
struct MediaApp: Identifiable, Hashable {
    let id: String
    var name: String
}

/// The TV channel that is on, when the system knows it.
struct Channel: Hashable {
    var number: Int
    var name: String
}

/// Song or show info, when the system sends it.
struct NowPlaying: Hashable {
    var title: String
    var artist = ""
    var album = ""
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
    /// Playing rather than paused. Systems without play/pause feedback report "on".
    var isPlaying = false
    /// True when the room has play/pause/next/previous buttons.
    var canTransport = false
    var nowPlaying: NowPlaying? = nil
    /// "tv" or "audio". nil when the system doesn't say; then the name decides (see `resolvedKind`).
    var kind: String? = nil
    /// True for TVs that take remote-control keys (tvKey), apps (tvApp) and channel numbers.
    var canRemote = false
    var apps: [MediaApp] = []
    var channel: Channel? = nil
    /// Which system it comes from: "crestron", "homekit", "samsungtv" or "demo".
    var origin: String? = nil

    var currentSource: MediaSource? { sources.first { $0.id == currentSourceId } }

    /// "tv" or "audio": `kind`, or guessed from the name like normalizeHome in model.js.
    var resolvedKind: String { kind ?? (MediaZone.looksLikeTV(name) ? "tv" : "audio") }
    var isTV: Bool { resolvedKind == "tv" }

    /// Names like "TV", "Samsung TV" or "Televize" mean a television.
    static func looksLikeTV(_ name: String) -> Bool {
        name.range(of: "\\btv\\b|telev", options: [.regularExpression, .caseInsensitive]) != nil
    }
}

struct DoorLock: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// nil when the system gives no feedback.
    var isLocked: Bool?
    var origin: String? = nil
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

    /// `title` in the app's language. `title` itself stays English for Ask Home's model.
    var label: String { L(title) }

    var isArmed: Bool { self == .armedAway || self == .armedHome }
}

struct SecurityPanel: Identifiable, Hashable {
    let id: String
    var name: String
    var mode: SecurityMode
    var needsCode = true
    var canArmHome = true
    var canArmAway = true
    var origin: String? = nil
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

    /// `title` in the app's language.
    var label: String { L(title) }
}

struct Gate: Identifiable, Hashable {
    let id: String
    var name: String
    var state: GateState
    /// True when there are separate Open and Close commands. Otherwise one
    /// "trigger" pulse toggles the gate (the usual relay setup).
    var hasSeparateOpenClose: Bool
    var canStop: Bool
    var origin: String? = nil
}

struct HomeSensor: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    var kind: String
    var isActive: Bool
    var origin: String? = nil
}

/// A doorbell button. `ringAt` is when it was last pressed; the iPad shows a pop-up
/// with the camera whose name matches `cameraName` (or the first camera).
struct Doorbell: Identifiable, Hashable {
    let id: String
    var name: String
    var cameraName: String? = nil
    var lockId: String? = nil
    var ringAt: Date? = nil
    var origin: String? = nil
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
    var doorbells: [Doorbell] = []
    var climate: [Climate] = []
    var modes: [HomeMode] = []
    var switches: [HomeSwitch] = []
}

enum GateAction: String {
    case open, close, stop, trigger
}

enum MediaTransportAction: String, Hashable {
    case play, pause, next, previous
}

/// Remote-control keys a TV may accept. Same list as TV_KEYS in model.js.
enum TVKey: String, Hashable, CaseIterable {
    case up, down, left, right, ok, back, home, menu, exit, info, guide
    case chUp, chDown, volUp, volDown, mute, power
    case play, pause, stop, rewind, fastForward
    case num0, num1, num2, num3, num4, num5, num6, num7, num8, num9
    case red, green, yellow, blue

    /// The digit for num0…num9, else nil.
    var digit: Int? {
        guard rawValue.hasPrefix("num") else { return nil }
        return Int(rawValue.dropFirst(3))
    }
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
    case mediaTransport(zoneId: String, action: MediaTransportAction)
    case setLock(id: String, locked: Bool)
    case setSecurity(id: String, mode: SecurityMode, code: String?)
    case gate(id: String, action: GateAction)
    /// A thermostat's target temperature in °C.
    case setClimate(id: String, target: Double)
    /// One of a mode's option ids (the house heating mode).
    case setMode(id: String, value: String)
    /// Sauna, motion-sensor lights, pumps…
    case setSwitch(id: String, on: Bool)
    /// One press on a TV remote (TVs with `canRemote`).
    case tvKey(zoneId: String, key: TVKey)
    /// Open an app on a TV, by its id from `apps`.
    case tvApp(zoneId: String, appId: String)
    /// Tune a TV to a channel number.
    case mediaChannel(zoneId: String, channel: Int)

    /// The device, scene, zone… the command is for. The store routes it to the system that owns it.
    var deviceId: String {
        switch self {
        case let .setLight(id, _), let .setShade(id, _), let .stopShade(id), let .recallScene(id):
            return id
        case let .mediaPower(id, _), let .mediaVolume(id, _), let .mediaMute(id, _), let .mediaSource(id, _), let .mediaTransport(id, _):
            return id
        case let .setLock(id, _), let .setSecurity(id, _, _), let .gate(id, _), let .setClimate(id, _), let .setMode(id, _), let .setSwitch(id, _):
            return id
        case let .tvKey(id, _), let .tvApp(id, _), let .mediaChannel(id, _):
            return id
        }
    }

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
        case let .mediaTransport(id, action): action == .play || action == .pause ? "playing:\(id)" : nil
        case let .setLock(id, _): "lock:\(id)"
        case let .setSecurity(id, _, _): "security:\(id)"
        case let .setClimate(id, _): "climate:\(id)"
        case let .setMode(id, _): "mode:\(id)"
        case let .setSwitch(id, _): "switch:\(id)"
        case let .tvApp(id, _): "source:\(id)"
        case let .mediaChannel(id, _): "channel:\(id)"
        case .stopShade, .recallScene, .gate, .tvKey: nil
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
        case let .mediaTransport(id, action):
            if action == .play || action == .pause, let i = media.firstIndex(where: { $0.id == id }) {
                media[i].isPlaying = action == .play
            }
        case let .setLock(id, locked):
            if let i = locks.firstIndex(where: { $0.id == id }) { locks[i].isLocked = locked }
        case let .setSecurity(id, mode, _):
            if let i = security.firstIndex(where: { $0.id == id }) { security[i].mode = mode }
        case let .gate(id, action):
            if let i = gates.firstIndex(where: { $0.id == id }) {
                gates[i].state = action == .stop ? .unknown : .moving
            }
        case let .setClimate(id, target):
            if let i = climate.firstIndex(where: { $0.id == id }) { climate[i].target = climate[i].clampTarget(target) }
        case let .setMode(id, value):
            if let i = modes.firstIndex(where: { $0.id == id }), modes[i].options.contains(where: { $0.id == value }) {
                modes[i].value = value
            }
        case let .setSwitch(id, on):
            if let i = switches.firstIndex(where: { $0.id == id }) { switches[i].isOn = on }
        case let .tvKey(id, key):
            guard let i = media.firstIndex(where: { $0.id == id }) else { return }
            switch key {
            case .mute: media[i].isMuted.toggle()
            case .volUp where media[i].hasVolume: media[i].volume = (media[i].volume + 0.05).clamped01
            case .volDown where media[i].hasVolume: media[i].volume = (media[i].volume - 0.05).clamped01
            case .play: media[i].isPlaying = true
            case .pause: media[i].isPlaying = false
            default: break
            }
        case let .tvApp(id, _):
            if let i = media.firstIndex(where: { $0.id == id }) {
                media[i].isOn = true
                media[i].currentSourceId = nil
                media[i].isPlaying = true
            }
        case let .mediaChannel(id, number):
            if let i = media.firstIndex(where: { $0.id == id }) {
                // Keep the channel name only when it's the same channel.
                let name = media[i].channel?.number == number ? (media[i].channel?.name ?? "") : ""
                media[i].channel = Channel(number: number, name: name)
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
