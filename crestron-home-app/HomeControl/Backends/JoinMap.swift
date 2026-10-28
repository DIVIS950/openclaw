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

    struct RoomEntry: Codable {
        var id: String
        var name: String
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
    }

    static func parse(_ json: String) throws -> JoinMap {
        do {
            return try JSONDecoder().decode(JoinMap.self, from: Data(json.utf8))
        } catch let DecodingError.keyNotFound(key, context) {
            throw BackendError.badResponse("Join map: “\(key.stringValue)” is missing at \(Self.path(context)).")
        } catch let DecodingError.typeMismatch(_, context) {
            throw BackendError.badResponse("Join map: wrong value type at \(Self.path(context)).")
        } catch {
            throw BackendError.badResponse("Join map isn't valid JSON: \(error.localizedDescription)")
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        let parts = context.codingPath.map { $0.intValue.map { "#\($0 + 1)" } ?? $0.stringValue }
        return parts.isEmpty ? "the top level" : parts.joined(separator: " › ")
    }

    static let example = """
    {
      "rooms": [
        { "id": "living", "name": "Living Room" },
        { "id": "kitchen", "name": "Kitchen" }
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
          "armedAwayFeedback": 401, "armedHomeFeedback": 402, "disarmedFeedback": 403, "alarmFeedback": 404 }
      ],
      "gates": [
        { "name": "Driveway Gate", "open": 501, "close": 502, "stop": 503,
          "openFeedback": 504, "closedFeedback": 505 }
      ]
    }
    """
}
