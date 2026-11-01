import Foundation

/// Ask Home: plain requests ("turn off the kitchen lights", "good night") become house
/// commands, using Claude with one tool, `control_home`. Mirrors the web app's assistant
/// (web/public/shared/assistant-core.js and web/server/assistant.js).
///
/// Safety lives in code, not just in the instructions: unlocking a door and opening the
/// gate come back as Confirm buttons the person must tap, and disarming is refused.
enum HomeAssistant {
    static let model = "claude-opus-5-5"
    private static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    private static let maxTurns = 6

    static let rules = """
    You are the voice-and-chat assistant for a Crestron-controlled home, shown on wall iPads and phones.
    You control the house only through the control_home tool. Each request includes the current home state as JSON; use the exact ids from it.

    How to act:
    - Do what was asked with as few tool calls as possible: put every command for one request in a single control_home call.
    - Light levels, shade positions and volume are numbers from 0 to 1 (0 = off/closed, 1 = full/open). "Dim" means about 0.3; "turn on" means 1 unless a level is given.
    - "All lights" / "the house" means every light. A room name means every light in that room. If a request is genuinely ambiguous, ask one short question instead of guessing.
    - Scenes: prefer recalling a matching scene (for example "good night") over setting devices one by one.
    - For questions ("is the front door locked?", "what's on?"), answer from the state without calling the tool.
    - Unlocking doors and opening the gate need the person to confirm: request them with the tool anyway; the app shows a confirm button. Say that they need to tap it.
    - You cannot disarm the alarm; tell the person to use the keypad.

    How to answer:
    - One or two short, friendly sentences in the person's language. No lists, no markdown, no ids.
    - Only say something happened if the tool result says it did.
    """

    static let toolName = "control_home"

    private static let toolDescription =
        "Send one or more commands to the house. Each command needs `type` and the device `id` from the home state, plus the field its type uses: " +
        "setLight → level; setShade → position; stopShade → (nothing); recallScene → (nothing); mediaPower → on; mediaVolume → level; " +
        "mediaMute → muted; mediaSource → sourceId; setLock → locked; setSecurity → mode (armedAway or armedHome); gate → action (open, close, stop, trigger). " +
        "Returns one line per command saying whether it was done, needs the person to confirm, or was refused."

    private static var toolSchema: [String: Any] {
        [
            "type": "object",
            "properties": [
                "commands": [
                    "type": "array",
                    "minItems": 1,
                    "items": [
                        "type": "object",
                        "properties": [
                            "type": ["type": "string", "enum": ["setLight", "setShade", "stopShade", "recallScene", "mediaPower", "mediaVolume",
                                                                "mediaMute", "mediaSource", "setLock", "setSecurity", "gate"]],
                            "id": ["type": "string", "description": "Device, scene, media room, lock, alarm or gate id from the home state."],
                            "level": ["type": "number", "minimum": 0, "maximum": 1],
                            "position": ["type": "number", "minimum": 0, "maximum": 1],
                            "on": ["type": "boolean"],
                            "muted": ["type": "boolean"],
                            "sourceId": ["type": "string"],
                            "locked": ["type": "boolean"],
                            "mode": ["type": "string", "enum": ["armedAway", "armedHome", "disarmed"]],
                            "action": ["type": "string", "enum": ["open", "close", "stop", "trigger"]],
                        ],
                        "required": ["type", "id"],
                        "additionalProperties": false,
                    ],
                ],
            ],
            "required": ["commands"],
            "additionalProperties": false,
        ]
    }

    struct Confirmation: Identifiable {
        let id = UUID()
        let label: String
        let command: HomeCommand
    }

    struct Reply {
        var text: String
        var done: [String] = []
        var confirm: [Confirmation] = []
        var failed: [String] = []
    }

    enum Failure: LocalizedError {
        case badKey, notAllowed, busy, offline, badResponse
        case service(Int)

        var errorDescription: String? {
            switch self {
            case .badKey: "The AI key isn't valid. Check it in Settings › AI assistant."
            case .notAllowed: "This AI key isn't allowed to use the assistant model."
            case .busy: "The assistant is busy right now. Try again in a minute."
            case .offline: "Can't reach the AI service. Check the internet connection."
            case .badResponse: "The AI service sent an answer the app couldn't read. Try again."
            case let .service(code): "The AI service had a problem (\(code)). Try again."
            }
        }
    }

    // MARK: Running a request

    /// Runs one request: asks Claude, carries out its tool calls, and loops until it answers.
    @MainActor
    static func run(message: String, history: [(role: String, text: String)], store: HomeStore, apiKey: String) async throws -> Reply {
        var messages: [[String: Any]] = []
        for turn in history.suffix(12) where !turn.text.isEmpty {
            messages.append(["role": turn.role, "content": String(turn.text.prefix(2000))])
        }
        // The live state goes in the newest user turn, after the cached instructions and tool.
        let state = String(data: try JSONSerialization.data(withJSONObject: homeForModel(store.home), options: [.sortedKeys]), encoding: .utf8) ?? "{}"
        messages.append(["role": "user", "content": [
            ["type": "text", "text": "Current home state:\n\(state)"],
            ["type": "text", "text": String(message.prefix(2000))],
        ]])

        var reply = Reply(text: "")
        for _ in 0..<maxTurns {
            let response = try await send(messages, apiKey: apiKey)
            let stop = response["stop_reason"] as? String
            let content = response["content"] as? [[String: Any]] ?? []
            // A declined request (after Anthropic's own fallback model also declined).
            if stop == "refusal" {
                reply.text = "Sorry, I can't help with that one."
                return reply
            }
            let toolUses = content.filter { $0["type"] as? String == "tool_use" }
            if stop != "tool_use" || toolUses.isEmpty {
                let text = content.filter { $0["type"] as? String == "text" }
                    .compactMap { $0["text"] as? String }
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                reply.text = text.isEmpty ? (reply.done.isEmpty ? "Sorry, I didn't catch that." : "Done.") : text
                return reply
            }
            // Send the whole assistant turn back unchanged (thinking blocks included), then the results.
            messages.append(["role": "assistant", "content": content])
            var results: [[String: Any]] = []
            for use in toolUses {
                let outcome: Outcome = (use["name"] as? String) == toolName
                    ? apply(use["input"] as? [String: Any] ?? [:], store: store)
                    : Outcome(text: "Unknown tool \(use["name"] as? String ?? "")", isError: true)
                reply.done += outcome.done
                reply.confirm += outcome.confirm
                reply.failed += outcome.failed
                results.append(["type": "tool_result", "tool_use_id": use["id"] as? String ?? "", "content": outcome.text, "is_error": outcome.isError])
            }
            messages.append(["role": "user", "content": results])
        }
        reply.text = reply.done.isEmpty ? "Sorry, that took too many steps. Try asking in a simpler way." : "Done."
        return reply
    }

    private static func send(_ messages: [[String: Any]], apiKey: String) async throws -> [String: Any] {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 90
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        request.setValue("2026-10-21", forHTTPHeaderField: "anthropic-version")
        request.setValue("server-side-fallback-2026-07-01", forHTTPHeaderField: "anthropic-beta")
        let body: [String: Any] = [
            "model": model,
            "max_tokens": 16000,
            // Short home requests don't need deep reasoning; low effort keeps answers quick.
            "output_config": ["effort": "low"],
            "system": [["type": "text", "text": rules, "cache_control": ["type": "ephemeral"]]],
            "tools": [["name": toolName, "description": toolDescription, "input_schema": toolSchema]],
            "messages": messages,
            // If a safety classifier declines a request, Anthropic re-runs it on its recommended model.
            "fallbacks": "default",
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let result: (Data, URLResponse)
        do {
            result = try await URLSession.shared.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw Failure.offline
        }
        let (data, response) = result
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200..<300: break
        case 401: throw Failure.badKey
        case 403: throw Failure.notAllowed
        case 429, 529: throw Failure.busy
        default: throw Failure.service(status)
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.badResponse }
        return json
    }

    // MARK: The tool

    struct Outcome {
        var text: String
        var isError = false
        var done: [String] = []
        var confirm: [Confirmation] = []
        var failed: [String] = []
    }

    /// Applies one control_home call: runs what is safe, holds back what needs a tap, refuses disarming.
    @MainActor
    static func apply(_ input: [String: Any], store: HomeStore) -> Outcome {
        let commands = input["commands"] as? [[String: Any]] ?? []
        var outcome = Outcome(text: "", isError: commands.isEmpty)
        var lines: [String] = []
        for raw in commands {
            let (parsed, problem) = command(from: raw)
            guard let command = parsed else {
                lines.append("\(raw["type"] as? String ?? "?") \(raw["id"] as? String ?? ""): rejected (\(problem ?? "invalid"))")
                continue
            }
            let home = store.home
            let label = describe(command, home: home)
            if case .setSecurity(_, .disarmed, _) = command {
                lines.append("\(label): refused, disarming needs the keypad code")
                continue
            }
            if needsConfirmation(command, home: home) {
                outcome.confirm.append(Confirmation(label: label, command: command))
                lines.append("\(label): waiting for the person to tap Confirm in the app")
                continue
            }
            store.perform(command)
            outcome.done.append(label)
            lines.append("\(label): done")
        }
        outcome.text = lines.isEmpty ? "No commands were given." : lines.joined(separator: "\n")
        return outcome
    }

    /// Commands the AI may ask for but a person must confirm by tapping.
    static func needsConfirmation(_ command: HomeCommand, home: HomeSnapshot) -> Bool {
        switch command {
        case let .setLock(_, locked):
            return !locked
        case let .gate(id, action):
            let gate = home.gates.first { $0.id == id }
            return action == .open || (action == .trigger && gate?.state != .open)
        default:
            return false
        }
    }

    /// Reads one command from the tool input. Only the fields its type uses are read.
    static func command(from raw: [String: Any]) -> (HomeCommand?, String?) {
        guard let type = raw["type"] as? String, let id = raw["id"] as? String, !id.isEmpty else { return (nil, "missing type or id") }
        let number = { (key: String) in (raw[key] as? NSNumber)?.doubleValue }
        switch type {
        case "setLight":
            guard let level = number("level") else { return (nil, "missing level") }
            return (.setLight(id: id, level: level.clamped01), nil)
        case "setShade":
            guard let position = number("position") else { return (nil, "missing position") }
            return (.setShade(id: id, position: position.clamped01), nil)
        case "stopShade":
            return (.stopShade(id: id), nil)
        case "recallScene":
            return (.recallScene(id: id), nil)
        case "mediaPower":
            guard let on = raw["on"] as? Bool else { return (nil, "missing on") }
            return (.mediaPower(zoneId: id, on: on), nil)
        case "mediaVolume":
            guard let level = number("level") else { return (nil, "missing level") }
            return (.mediaVolume(zoneId: id, level: level.clamped01), nil)
        case "mediaMute":
            guard let muted = raw["muted"] as? Bool else { return (nil, "missing muted") }
            return (.mediaMute(zoneId: id, muted: muted), nil)
        case "mediaSource":
            guard let sourceId = raw["sourceId"] as? String else { return (nil, "missing sourceId") }
            return (.mediaSource(zoneId: id, sourceId: sourceId), nil)
        case "setLock":
            guard let locked = raw["locked"] as? Bool else { return (nil, "missing locked") }
            return (.setLock(id: id, locked: locked), nil)
        case "setSecurity":
            guard let mode = (raw["mode"] as? String).flatMap(SecurityMode.init(rawValue:)),
                  [.disarmed, .armedHome, .armedAway].contains(mode)
            else { return (nil, "bad mode") }
            return (.setSecurity(id: id, mode: mode, code: nil), nil)
        case "gate":
            guard let action = (raw["action"] as? String).flatMap(GateAction.init(rawValue:)) else { return (nil, "bad action") }
            return (.gate(id: id, action: action), nil)
        default:
            return (nil, "unknown command")
        }
    }

    /// Short description for the chat, e.g. "Pendants → 30%".
    static func describe(_ command: HomeCommand, home: HomeSnapshot) -> String {
        func name<T: Identifiable>(_ list: [T], _ id: String, _ title: (T) -> String) -> String where T.ID == String {
            list.first { $0.id == id }.map(title) ?? id
        }
        switch command {
        case let .setLight(id, level):
            return "\(name(home.lights, id, \.name)) → \(level > 0 ? level.percentText : "off")"
        case let .setShade(id, position):
            return "\(name(home.shades, id, \.name)) → \(position >= 0.99 ? "open" : position <= 0.01 ? "closed" : position.percentText)"
        case let .stopShade(id):
            return "\(name(home.shades, id, \.name)) → stop"
        case let .recallScene(id):
            return "Scene: \(name(home.scenes, id, \.name))"
        case let .mediaPower(id, on):
            return "\(name(home.media, id, \.name)) → \(on ? "on" : "off")"
        case let .mediaVolume(id, level):
            return "\(name(home.media, id, \.name)) volume → \(level.percentText)"
        case let .mediaMute(id, muted):
            return "\(name(home.media, id, \.name)) → \(muted ? "muted" : "unmuted")"
        case let .mediaSource(id, sourceId):
            let zone = home.media.first { $0.id == id }
            return "\(zone?.name ?? id) → \(zone?.sources.first { $0.id == sourceId }?.name ?? sourceId)"
        case let .setLock(id, locked):
            return "\(locked ? "Lock" : "Unlock") \(name(home.locks, id, \.name))"
        case let .setSecurity(id, mode, _):
            return "\(name(home.security, id, \.name)) → \(mode.title)"
        case let .gate(id, action):
            return "\(name(home.gates, id, \.name)) → \(action.rawValue)"
        }
    }

    /// A compact view of the house for the model: names, ids and state, nothing else.
    static func homeForModel(_ home: HomeSnapshot) -> [String: Any] {
        let room = { (id: String?) -> Any in home.room(id).map { $0.name as Any } ?? NSNull() }
        let pct = { (value: Double) in Int((value * 100).rounded()) }
        let lights: [[String: Any]] = home.lights.map {
            ["id": $0.id, "name": $0.name, "room": room($0.roomId), "level": pct($0.level), "dimmable": $0.isDimmable]
        }
        let shades: [[String: Any]] = home.shades.map {
            ["id": $0.id, "name": $0.name, "room": room($0.roomId), "openPercent": pct($0.position), "canStop": $0.supportsStop]
        }
        let scenes: [[String: Any]] = home.scenes.map {
            ["id": $0.id, "name": $0.name, "room": home.room($0.roomId)?.name ?? "whole house", "active": $0.isActive]
        }
        let media: [[String: Any]] = home.media.map { zone in
            let sources: [[String: Any]] = zone.sources.map { ["id": $0.id, "name": $0.name] }
            return [
                "id": zone.id, "name": zone.name, "on": zone.isOn, "volume": pct(zone.volume), "muted": zone.isMuted,
                "source": zone.currentSource.map { $0.name as Any } ?? NSNull(), "sources": sources,
            ]
        }
        let locks: [[String: Any]] = home.locks.map { lock in
            let locked: Any = lock.isLocked.map { $0 as Any } ?? NSNull()
            return ["id": lock.id, "name": lock.name, "room": room(lock.roomId), "locked": locked]
        }
        let alarms: [[String: Any]] = home.security.map { ["id": $0.id, "name": $0.name, "mode": $0.mode.title] }
        let gates: [[String: Any]] = home.gates.map {
            ["id": $0.id, "name": $0.name, "state": $0.state.title, "separateOpenClose": $0.hasSeparateOpenClose]
        }
        return [
            "rooms": home.rooms.map(\.name), "lights": lights, "shades": shades, "scenes": scenes,
            "media": media, "locks": locks, "alarms": alarms, "gates": gates,
        ]
    }
}
