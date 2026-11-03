import Foundation

/// Describes which joins the dealer's SIMPL program uses for each control, so the app
/// can act like the existing Crestron Go panel. Feedback joins default to the same
/// number as the press join (the usual SIMPL convention) when left out.
struct JoinMap: Codable {
    var rooms: [RoomEntry]
    var lights: [LightEntry]
    var shades: [ShadeEntry]
    var scenes: [SceneEntry]
    var media: [MediaEntry]
    var locks: [LockEntry]
    var security: [SecurityEntry]
    var gates: [GateEntry]
    var doorbells: [DoorbellEntry]
    var climate: [ClimateEntry]
    var modes: [ModeEntry]
    var switches: [SwitchEntry]

    struct RoomEntry: Codable {
        var id: String
        var name: String
        /// Optional floor name like "1.NP", to group rooms.
        var floor: String?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = try c.decode(String.self, forKey: .name)
            // A floor typed as a number (1) works too.
            floor = JoinMap.lenientString(c, CodingKeys.floor)
        }
    }

    struct LightEntry: Codable {
        var name: String
        var room: String?
        /// Analog join for dimmers (0-65535 both directions).
        var level: Int?
        /// Digital joins for switched loads.
        var on: Int?
        var off: Int?
        var onFeedback: Int?
    }

    struct ShadeEntry: Codable {
        var name: String
        var room: String?
        /// Analog position join (0 = closed, 65535 = open).
        var position: Int?
        var open: Int?
        var close: Int?
        var stop: Int?
    }

    struct SceneEntry: Codable {
        var name: String
        var room: String?
        var press: Int
        var feedback: Int?
    }

    struct MediaEntry: Codable {
        var name: String
        var room: String?
        var powerOn: Int?
        var powerOff: Int?
        var powerFeedback: Int?
        /// Analog volume join.
        var volume: Int?
        /// Digital mute toggle.
        var mute: Int?
        var muteFeedback: Int?
        var sources: [SourceEntry]?
        /// Optional transport buttons. With only one of play/pause, it's used for both.
        var play: Int?
        var pause: Int?
        var next: Int?
        var previous: Int?
        /// High while playing (defaults to the power feedback).
        var playingFeedback: Int?
        /// Serial joins with the song or show name.
        var title: Int?
        var artist: Int?
        var album: Int?
    }

    struct SourceEntry: Codable {
        var name: String
        var press: Int
        var feedback: Int?
    }

    struct LockEntry: Codable {
        var name: String
        var room: String?
        var lock: Int
        var unlock: Int
        var lockedFeedback: Int?
    }

    struct SecurityEntry: Codable {
        var name: String
        var armAway: Int?
        var armHome: Int?
        var disarm: Int?
        var armedAwayFeedback: Int?
        var armedHomeFeedback: Int?
        var disarmedFeedback: Int?
        var alarmFeedback: Int?
        /// Serial join the keypad code is sent on before arming/disarming.
        var code: Int?
        /// One button that arms and disarms (used when there is no join for the mode).
        var toggle: Int?
    }

    struct GateEntry: Codable {
        var name: String
        var open: Int?
        var close: Int?
        var stop: Int?
        /// Single relay pulse that toggles the gate.
        var trigger: Int?
        var openFeedback: Int?
        var closedFeedback: Int?
    }

    struct DoorbellEntry: Codable {
        var name: String
        /// Digital join that goes high when someone presses the button.
        var ring: Int
        /// Name of the camera to show, as set up in Settings › Cameras.
        var camera: String?
        /// Name of the lock (from "locks") to offer hold-to-unlock for.
        var lock: String?
    }

    /// A room thermostat. Temperatures travel as whole numbers: °C × scale (215 = 21.5 °C).
    struct ClimateEntry: Codable {
        var name: String
        var room: String?
        /// Analog: the room temperature.
        var current: Int?
        /// Analog: the set temperature, read and (unless targetWritable is false) written.
        var target: Int?
        var targetWritable: Bool?
        /// Digital pulses that step the set temperature, for programs that can't take a new value.
        var up: Int?
        var down: Int?
        /// Digital: high while heating.
        var heating: Int?
        /// Default 10.
        var scale: Double?
        var min: Double?
        var max: Double?
        var step: Double?
    }

    /// A house mode, such as the heating mode.
    struct ModeEntry: Codable {
        var name: String
        var kind: String?
        /// Analog join, when the mode is one number (each option has a `value`).
        var analog: Int?
        var options: [ModeOptionEntry]

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            name = try c.decode(String.self, forKey: .name)
            kind = try c.decodeIfPresent(String.self, forKey: .kind)
            analog = try c.decodeIfPresent(Int.self, forKey: .analog)
            options = try c.decodeIfPresent([ModeOptionEntry].self, forKey: .options) ?? []
        }
    }

    struct ModeOptionEntry: Codable {
        var id: String?
        var name: String?
        /// Digital pulse that picks this option.
        var press: Int?
        /// Digital: high while this option is on (defaults to `press`).
        var feedback: Int?
        /// The analog value for this option.
        var value: Double?

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = JoinMap.lenientString(c, CodingKeys.id)
            name = JoinMap.lenientString(c, CodingKeys.name)
            press = try c.decodeIfPresent(Int.self, forKey: .press)
            feedback = try c.decodeIfPresent(Int.self, forKey: .feedback)
            value = try c.decodeIfPresent(Double.self, forKey: .value)
        }

        /// Its own id, or its position ("1", "2"…). Same as optionId in custom-program.js.
        func optionId(_ index: Int) -> String { id ?? String(index + 1) }
    }

    /// The sauna, motion-sensor lights, a pump…
    struct SwitchEntry: Codable {
        var name: String
        var room: String?
        /// "sauna", "motion" or anything else.
        var kind: String?
        var on: Int?
        var off: Int?
        var toggle: Int?
        /// Digital: high while on (defaults to `on`).
        var feedback: Int?
        /// Analog temperature (the sauna), °C × scale.
        var temperature: Int?
        var scale: Double?
    }

    /// A text field that may also be written as a number in the JSON.
    fileprivate static func lenientString<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) -> String? {
        if let text = try? c.decodeIfPresent(String.self, forKey: key) { return text }
        if let number = try? c.decodeIfPresent(Int.self, forKey: key) { return String(number) }
        if let number = try? c.decodeIfPresent(Double.self, forKey: key) { return String(number) }
        return nil
    }

    init(from decoder: Decoder) throws {
        // Every section is optional so a map can start small (just lights, say).
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rooms = try c.decodeIfPresent([RoomEntry].self, forKey: .rooms) ?? []
        lights = try c.decodeIfPresent([LightEntry].self, forKey: .lights) ?? []
        shades = try c.decodeIfPresent([ShadeEntry].self, forKey: .shades) ?? []
        scenes = try c.decodeIfPresent([SceneEntry].self, forKey: .scenes) ?? []
        media = try c.decodeIfPresent([MediaEntry].self, forKey: .media) ?? []
        locks = try c.decodeIfPresent([LockEntry].self, forKey: .locks) ?? []
        security = try c.decodeIfPresent([SecurityEntry].self, forKey: .security) ?? []
        gates = try c.decodeIfPresent([GateEntry].self, forKey: .gates) ?? []
        doorbells = try c.decodeIfPresent([DoorbellEntry].self, forKey: .doorbells) ?? []
        climate = try c.decodeIfPresent([ClimateEntry].self, forKey: .climate) ?? []
        modes = try c.decodeIfPresent([ModeEntry].self, forKey: .modes) ?? []
        switches = try c.decodeIfPresent([SwitchEntry].self, forKey: .switches) ?? []
    }

    static func parse(_ json: String) throws -> JoinMap {
        do {
            // The iOS keyboard turns typed quotes into curly ones; JSON needs straight quotes.
            let straight = json
                .replacingOccurrences(of: "[\u{201C}\u{201D}\u{201E}]", with: "\"", options: .regularExpression)
                .replacingOccurrences(of: "[\u{2018}\u{2019}]", with: "'", options: .regularExpression)
            let map = try JSONDecoder().decode(JoinMap.self, from: Data(straight.utf8))
            if let empty = map.modes.firstIndex(where: { $0.options.isEmpty }) {
                throw BackendError.badResponse(L("Join map: modes #{n} needs a list of “options”.", ["n": String(empty + 1)]))
            }
            return map
        } catch let error as BackendError {
            throw error
        } catch let DecodingError.keyNotFound(key, context) {
            throw BackendError.badResponse(L("Join map: “{key}” is missing at {path}.", ["key": key.stringValue, "path": Self.path(context)]))
        } catch let DecodingError.typeMismatch(_, context) {
            throw BackendError.badResponse(L("Join map: wrong value type at {path}.", ["path": Self.path(context)]))
        } catch {
            throw BackendError.badResponse(L("Join map isn't valid JSON: {error}", ["error": error.localizedDescription]))
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        let parts = context.codingPath.map { $0.intValue.map { "#\($0 + 1)" } ?? $0.stringValue }
        return parts.isEmpty ? L("the top level") : parts.joined(separator: " › ")
    }

    static let example = """
    {
      "rooms": [
        { "id": "living", "name": "Living Room", "floor": "1.NP" },
        { "id": "kitchen", "name": "Kitchen", "floor": "1.NP" },
        { "id": "sauna", "name": "Sauna", "floor": "Suterén" }
      ],
      "lights": [
        { "name": "Ceiling", "room": "living", "level": 11 },
        { "name": "Pendants", "room": "kitchen", "level": 12 },
        { "name": "Patio Lights", "on": 41, "off": 42, "onFeedback": 41 }
      ],
      "shades": [
        { "name": "Window Shades", "room": "living", "position": 21, "open": 51, "close": 52, "stop": 53 }
      ],
      "scenes": [
        { "name": "Good Night", "press": 101 },
        { "name": "Movie", "room": "living", "press": 102 }
      ],
      "media": [
        {
          "name": "Living Room", "room": "living",
          "powerOn": 201, "powerOff": 202, "powerFeedback": 201,
          "volume": 31, "mute": 203,
          "play": 221, "pause": 222, "next": 223, "previous": 224, "playingFeedback": 221,
          "title": 1, "artist": 2, "album": 3,
          "sources": [
            { "name": "Apple TV", "press": 211 },
            { "name": "Cable", "press": 212 }
          ]
        }
      ],
      "locks": [
        { "name": "Front Door", "lock": 301, "unlock": 302, "lockedFeedback": 301 }
      ],
      "security": [
        { "name": "Alarm", "armAway": 401, "armHome": 402, "disarm": 403, "code": 401,
          "armedAwayFeedback": 401, "armedHomeFeedback": 402, "disarmedFeedback": 403, "alarmFeedback": 404 },
        { "name": "Garage", "toggle": 411, "armedAwayFeedback": 411 }
      ],
      "doorbells": [
        { "name": "Front Door", "ring": 601, "camera": "Front Door", "lock": "Front Door" }
      ],
      "gates": [
        { "name": "Driveway Gate", "open": 501, "close": 502, "stop": 503,
          "openFeedback": 504, "closedFeedback": 505 }
      ],
      "climate": [
        { "name": "Living Room", "room": "living", "current": 41, "target": 42, "heating": 701,
          "scale": 10, "min": 5, "max": 30, "step": 0.5 },
        { "name": "Kitchen", "room": "kitchen", "current": 43, "target": 44, "targetWritable": false,
          "up": 711, "down": 712, "heating": 713 }
      ],
      "modes": [
        { "name": "House heating", "kind": "heating", "options": [
          { "id": "on", "name": "On", "press": 721 },
          { "id": "individual", "name": "Individual", "press": 722 },
          { "id": "eco", "name": "Eco", "press": 723 },
          { "id": "off", "name": "Off", "press": 724 }
        ] }
      ],
      "switches": [
        { "name": "Sauna", "room": "sauna", "kind": "sauna", "on": 731, "off": 732, "feedback": 733,
          "temperature": 45, "scale": 10 }
      ]
    }
    """
}
