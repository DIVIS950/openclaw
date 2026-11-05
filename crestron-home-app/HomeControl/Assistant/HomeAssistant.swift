import Foundation

/// Ask Home: plain requests ("turn off the kitchen lights", "good night") become house
/// commands, using Claude with three tools: `control_home`, `set_timer` and
/// `create_schedule`. Mirrors the web app's assistant (web/public/shared/assistant-core.js
/// and web/server/assistant.js).
///
/// Safety lives in code, not just in the instructions: unlocking a door and opening the
/// gate come back as Confirm buttons the person must tap, disarming is refused, and timers
/// and schedules can't open anything.
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
    - "Later" requests ("turn off the kitchen lights in 30 minutes", "sleep timer for an hour") use set_timer. Repeating requests ("every night at 11 close the shades", "weekdays at sunset turn on the patio lights") use create_schedule. Confirm what you set up in one sentence.
    - "Here", "this room" and "in here" mean the room the person is looking at, given as viewingRoom in the state.
    - Heating: each room thermostat has a current and a target temperature in °C; setClimate sets the target (steps of 0.5). "Warmer"/"colder" means ±1 °C. The whole-house heating mode is a mode (setMode with one of its option ids). The sauna and similar things are switches (setSwitch on/off).
    - Rooms are grouped by floor (for example 1.NP, 2.NP, Suterén, Venek); "upstairs"/"nahoře" means the floors above 1.NP.
    - TVs with canRemote accept tvKey (remote buttons), tvApp (launch an app by appId) and mediaChannel (number). "Put on Netflix" → tvApp; "channel 4" → mediaChannel.
    - Media rooms with kind "tv" are televisions; their apps list what can be opened, and channel is what is on. origin says which system a device belongs to.
    - Names in this house are Czech. If the person writes Czech, answer in Czech.

    How to answer:
    - One or two short, friendly sentences in the person's language. No lists, no markdown, no ids.
    - Only say something happened if the tool result says it did.
    """

    static let toolName = "control_home"
    static let timerToolName = "set_timer"
    static let scheduleToolName = "create_schedule"

    private static let toolDescription =
        "Send one or more commands to the house. Each command needs `type` and the device `id` from the home state, plus the field its type uses: " +
        "setLight → level; setShade → position; stopShade → (nothing); recallScene → (nothing); mediaPower → on; mediaVolume → level; " +
        "mediaMute → muted; mediaSource → sourceId; setLock → locked; setSecurity → mode (armedAway or armedHome); gate → action (open, close, stop, trigger); " +
        "setClimate → target (°C); setMode → value (an option id of that mode); setSwitch → on; " +
        "tvKey → key (a remote button); tvApp → appId (from the TV's apps); mediaChannel → channel (a number). " +
        "Returns one line per command saying whether it was done, needs the person to confirm, or was refused."

    private static var toolSchema: [String: Any] {
        let commands: [String: Any] = ["type": "array", "minItems": 1, "items": commandItemSchema]
        return [
            "type": "object",
            "properties": ["commands": commands] as [String: Any],
            "required": ["commands"],
            "additionalProperties": false,
        ]
    }

    private static let timerToolDescription =
        "Run commands once, later: after the given number of minutes (1 to 1440). Use it for \"in 30 minutes\", \"sleep timer\" and similar. " +
        "Only lights, shades, scenes, music, heating, the sauna and locking (never unlocking, the gate or the alarm) can be timed."

    private static var timerToolSchema: [String: Any] {
        let minutes: [String: Any] = ["type": "integer", "minimum": 1, "maximum": 1440]
        let label: [String: Any] = ["type": "string", "description": "Short name shown in the app, e.g. \"Kitchen lights off\"."]
        let commands: [String: Any] = ["type": "array", "minItems": 1, "items": commandItemSchema]
        return [
            "type": "object",
            "properties": ["minutes": minutes, "label": label, "commands": commands] as [String: Any],
            "required": ["minutes", "label", "commands"],
            "additionalProperties": false,
        ]
    }

    private static let scheduleToolDescription =
        "Create a repeating schedule that the home runs by itself. when.type is \"time\" (with time \"HH:MM\", 24-hour) or \"sunrise\"/\"sunset\" (with offset in minutes, negative = before). " +
        "days are 0-6 (0 = Sunday). Actions: scene (id), lights (roomId or null for all, level 0-1), shades (roomId or null, position 0 or 1), mediaOff, lockAll."

    private static var scheduleToolSchema: [String: Any] {
        let whenType: [String: Any] = ["type": "string", "enum": ["time", "sunrise", "sunset"]]
        let whenTime: [String: Any] = ["type": "string", "description": "HH:MM, 24-hour, for type time"]
        let whenOffset: [String: Any] = ["type": "integer", "minimum": -180, "maximum": 180]
        let when: [String: Any] = [
            "type": "object",
            "properties": ["type": whenType, "time": whenTime, "offset": whenOffset] as [String: Any],
            "required": ["type"],
            "additionalProperties": false,
        ]
        let day: [String: Any] = ["type": "integer", "minimum": 0, "maximum": 6]
        let days: [String: Any] = ["type": "array", "items": day, "minItems": 1]
        let actionType: [String: Any] = ["type": "string", "enum": ["scene", "lights", "shades", "mediaOff", "lockAll"]]
        let actionId: [String: Any] = ["type": "string", "description": "scene id, for type scene"]
        let roomId: [String: Any] = ["type": ["string", "null"], "description": "room id, or null for the whole house"]
        let level: [String: Any] = ["type": "number", "minimum": 0, "maximum": 1]
        let position: [String: Any] = ["type": "number", "minimum": 0, "maximum": 1]
        let action: [String: Any] = [
            "type": "object",
            "properties": ["type": actionType, "id": actionId, "roomId": roomId, "level": level, "position": position] as [String: Any],
            "required": ["type"],
            "additionalProperties": false,
        ]
        let actions: [String: Any] = ["type": "array", "minItems": 1, "items": action]
        let name: [String: Any] = ["type": "string"]
        return [
            "type": "object",
            "properties": ["name": name, "when": when, "days": days, "actions": actions] as [String: Any],
            "required": ["name", "when", "days", "actions"],
            "additionalProperties": false,
        ]
    }

    /// One command, as control_home and set_timer take it.
    private static var commandItemSchema: [String: Any] {
        let commandTypes = ["setLight", "setShade", "stopShade", "recallScene", "mediaPower", "mediaVolume",
                            "mediaMute", "mediaSource", "setLock", "setSecurity", "gate", "setClimate", "setMode", "setSwitch",
                            "tvKey", "tvApp", "mediaChannel"]
        let unit: [String: Any] = ["type": "number", "minimum": 0, "maximum": 1]
        let tvKeys = TVKey.allCases.map(\.rawValue)
        let properties: [String: Any] = [
            "type": ["type": "string", "enum": commandTypes] as [String: Any],
            "id": ["type": "string", "description": "Device, scene, media room, lock, alarm, gate, thermostat, mode or switch id from the home state."],
            "target": ["type": "number", "minimum": 5, "maximum": 30, "description": "Target temperature in °C (setClimate)."] as [String: Any],
            "value": ["type": "string", "description": "Option id (setMode)."],
            "level": unit,
            "position": unit,
            "on": ["type": "boolean"],
            "muted": ["type": "boolean"],
            "sourceId": ["type": "string"],
            "locked": ["type": "boolean"],
            "mode": ["type": "string", "enum": ["armedAway", "armedHome", "disarmed"]] as [String: Any],
            "action": ["type": "string", "enum": ["open", "close", "stop", "trigger"]] as [String: Any],
            "key": ["type": "string", "enum": tvKeys, "description": "Remote button (tvKey)."] as [String: Any],
            "appId": ["type": "string", "description": "App id from the TV's apps (tvApp)."] as [String: Any],
            "channel": ["type": "integer", "minimum": 1, "description": "Channel number (mediaChannel)."] as [String: Any],
        ]
        return [
            "type": "object",
            "properties": properties,
            "required": ["type", "id"],
            "additionalProperties": false,
        ]
    }

    private static var tools: [[String: Any]] {
        [
            ["name": toolName, "description": toolDescription, "input_schema": toolSchema],
            ["name": timerToolName, "description": timerToolDescription, "input_schema": timerToolSchema],
            ["name": scheduleToolName, "description": scheduleToolDescription, "input_schema": scheduleToolSchema],
        ]
    }

    /// What the person is looking at and the weather, for the model. The time, schedules
    /// and timers are added from the clock and AutomationStore.
    struct Context {
        var viewingRoom: String?
        var weather: WeatherNow?
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
            case .badKey: L("The AI key isn't valid. Check it in Settings › AI assistant.")
            case .notAllowed: L("This AI key isn't allowed to use the assistant model.")
            case .busy: L("The assistant is busy right now. Try again in a minute.")
            case .offline: L("Can't reach the AI service. Check the internet connection.")
            case .badResponse: L("The AI service sent an answer the app couldn't read. Try again.")
            case let .service(code): L("The AI service had a problem ({code}). Try again.", ["code": String(code)])
            }
        }
    }

    // MARK: Running a request

    /// Runs one request: asks Claude, carries out its tool calls, and loops until it answers.
    @MainActor
    static func run(message: String, history: [(role: String, text: String)], store: HomeStore, automations: AutomationStore,
                    context: Context, apiKey: String) async throws -> Reply {
        var messages: [[String: Any]] = []
        for turn in history.suffix(12) where !turn.text.isEmpty {
            messages.append(["role": turn.role, "content": String(turn.text.prefix(2000))])
        }
        // The live state goes in the newest user turn, after the cached instructions and tool.
        let snapshot = homeForModel(store.home, context: context, automations: automations)
        let state = String(data: try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys]), encoding: .utf8) ?? "{}"
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
                reply.text = L("Sorry, I can't help with that one.")
                return reply
            }
            let toolUses = content.filter { $0["type"] as? String == "tool_use" }
            if stop != "tool_use" || toolUses.isEmpty {
                let text = content.filter { $0["type"] as? String == "text" }
                    .compactMap { $0["text"] as? String }
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                reply.text = text.isEmpty ? (reply.done.isEmpty ? L("Sorry, I didn't catch that.") : L("Done.")) : text
                return reply
            }
            // Send the whole assistant turn back unchanged (thinking blocks included), then the results.
            messages.append(["role": "assistant", "content": content])
            var results: [[String: Any]] = []
            for use in toolUses {
                let input = use["input"] as? [String: Any] ?? [:]
                let name = use["name"] as? String ?? ""
                let outcome: Outcome
                switch name {
                case toolName: outcome = apply(input, store: store)
                case timerToolName: outcome = applyTimer(input, automations: automations)
                case scheduleToolName: outcome = applySchedule(input, home: store.home, automations: automations)
                default: outcome = Outcome(text: "Unknown tool \(name)", isError: true)
                }
                reply.done += outcome.done
                reply.confirm += outcome.confirm
                reply.failed += outcome.failed
                results.append(["type": "tool_result", "tool_use_id": use["id"] as? String ?? "", "content": outcome.text, "is_error": outcome.isError])
            }
            messages.append(["role": "user", "content": results])
        }
        reply.text = reply.done.isEmpty ? L("Sorry, that took too many steps. Try asking in a simpler way.") : L("Done.")
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
            "tools": tools,
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
            // URLSession reports a cancelled task as URLError(.cancelled), not CancellationError.
            if Task.isCancelled { throw CancellationError() }
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
            // Qualified: the local `command` declared below would shadow the static func.
            let (parsed, problem) = Self.command(from: raw)
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

    /// Applies one set_timer call: checks every command can be timed (nothing that opens the
    /// house), then adds one timer for all of them.
    @MainActor
    static func applyTimer(_ input: [String: Any], automations: AutomationStore) -> Outcome {
        let rawMinutes = (input["minutes"] as? NSNumber)?.doubleValue ?? .nan
        let label = String((input["label"] as? String ?? L("Timer")).trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
        let name = label.isEmpty ? L("Timer") : label
        // Checked before converting, so a huge or missing number can't crash Int().
        guard rawMinutes.isFinite, rawMinutes.rounded() >= 1, rawMinutes.rounded() <= 1440 else {
            return Outcome(text: "Refused: minutes must be 1 to 1440.", isError: true)
        }
        let minutes = Int(rawMinutes.rounded())
        var timed: [TimerCommand] = []
        for raw in input["commands"] as? [[String: Any]] ?? [] {
            let (read, _) = Self.command(from: raw)
            guard let parsed = read, let command = TimerCommand(parsed) else {
                return Outcome(text: "Refused: \(raw["type"] as? String ?? "that command") can't be put on a timer.", isError: true)
            }
            timed.append(command)
        }
        guard !timed.isEmpty else { return Outcome(text: "Refused: no commands.", isError: true) }
        automations.addTimer(minutes: minutes, label: name, commands: timed)
        let when = minutes >= 60 && minutes % 60 == 0 ? "\(minutes / 60) h" : "\(minutes) min"
        return Outcome(text: "Timer set: \(name) in \(when).", done: [L("Timer: {name} in {when}", ["name": name, "when": when])])
    }

    /// Applies one create_schedule call: reads and checks the schedule, then saves it.
    /// Schedule actions can't open anything (lockAll only locks).
    @MainActor
    static func applySchedule(_ input: [String: Any], home: HomeSnapshot, automations: AutomationStore) -> Outcome {
        // Qualified: the local `schedule` below would shadow the static func.
        let (parsed, problem) = Self.schedule(from: input)
        guard let schedule = parsed else {
            return Outcome(text: "Refused: \(problem ?? "bad schedule")", isError: true)
        }
        automations.save(schedule)
        let when = AutomationRules.describeWhen(schedule)
        let what = schedule.actions.map { AutomationRules.describe($0, home: home) }.joined(separator: ", ")
        return Outcome(text: "Schedule created: \(schedule.name), \(when): \(what).", done: [L("Schedule: {name} · {when}", ["name": schedule.name, "when": when])])
    }

    /// Reads a schedule from create_schedule input. Returns the schedule, or the problem.
    static func schedule(from input: [String: Any]) -> (HomeSchedule?, String?) {
        var schedule = HomeSchedule(name: String((input["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(60)))
        let when = input["when"] as? [String: Any] ?? [:]
        let whenType = when["type"] as? String ?? ""
        switch whenType {
        case "time":
            let parts = (when["time"] as? String ?? "").split(separator: ":")
            guard parts.count == 2, (1...2).contains(parts[0].count), parts[1].count == 2,
                  let hour = Int(parts[0]), let minute = Int(parts[1]), (0..<24).contains(hour), (0..<60).contains(minute)
            else { return (nil, "Pick a time.") }
            schedule.trigger = .time
            schedule.minutes = hour * 60 + minute
        case "sunrise", "sunset":
            schedule.trigger = whenType == "sunrise" ? .sunrise : .sunset
            let offset = (when["offset"] as? NSNumber)?.doubleValue ?? 0
            schedule.offset = offset.isFinite ? Int(min(max(offset, -1440), 1440).rounded()) : 0
        default:
            return (nil, "Pick when it runs.")
        }
        let days = input["days"] as? [Any] ?? []
        var daySet = Set<Int>()
        for day in days {
            guard let number = day as? NSNumber, let value = Int(exactly: number.doubleValue), (0...6).contains(value) else {
                return (nil, "Pick the days.")
            }
            daySet.insert(value)
        }
        schedule.days = daySet.sorted()
        var actions: [AutomationAction] = []
        for raw in input["actions"] as? [[String: Any]] ?? [] {
            let number = { (key: String) in (raw[key] as? NSNumber)?.doubleValue ?? 0 }
            switch raw["type"] as? String ?? "" {
            case "scene": actions.append(.scene(id: raw["id"] as? String ?? ""))
            case "lights": actions.append(.lights(roomId: raw["roomId"] as? String, level: number("level").clamped01))
            case "shades": actions.append(.shades(roomId: raw["roomId"] as? String, position: number("position") >= 0.5 ? 1 : 0))
            case "mediaOff": actions.append(.mediaOff)
            case "lockAll": actions.append(.lockAll)
            default: return (nil, "Unknown action.")
            }
        }
        schedule.actions = actions
        if let problem = AutomationRules.validate(schedule) { return (nil, problem) }
        return (schedule, nil)
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
        case "setClimate":
            guard let target = number("target"), target.isFinite else { return (nil, "missing target") }
            return (.setClimate(id: id, target: target), nil)
        case "setMode":
            guard let value = raw["value"] as? String, !value.isEmpty else { return (nil, "missing value") }
            return (.setMode(id: id, value: value), nil)
        case "setSwitch":
            guard let on = raw["on"] as? Bool else { return (nil, "missing on") }
            return (.setSwitch(id: id, on: on), nil)
        case "tvKey":
            guard let key = (raw["key"] as? String).flatMap(TVKey.init(rawValue:)) else { return (nil, "bad key") }
            return (.tvKey(zoneId: id, key: key), nil)
        case "tvApp":
            guard let appId = raw["appId"] as? String, !appId.isEmpty else { return (nil, "missing appId") }
            return (.tvApp(zoneId: id, appId: appId), nil)
        case "mediaChannel":
            // Checked before converting, so a huge or fractional number can't crash Int().
            guard let channel = number("channel"), channel.isFinite, channel.rounded() == channel, channel >= 1, channel <= 9999 else {
                return (nil, "bad channel")
            }
            return (.mediaChannel(zoneId: id, channel: Int(channel)), nil)
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
            return "\(name(home.lights, id, \.name)) → \(level > 0 ? level.percentText : L("off"))"
        case let .setShade(id, position):
            return "\(name(home.shades, id, \.name)) → \(position >= 0.99 ? L("open") : position <= 0.01 ? L("closed") : position.percentText)"
        case let .stopShade(id):
            return "\(name(home.shades, id, \.name)) → \(L("stop"))"
        case let .recallScene(id):
            return L("Scene: {name}", ["name": name(home.scenes, id, \.name)])
        case let .mediaPower(id, on):
            return "\(name(home.media, id, \.name)) → \(on ? L("on") : L("off"))"
        case let .mediaVolume(id, level):
            return L("{name} volume → {level}", ["name": name(home.media, id, \.name), "level": level.percentText])
        case let .mediaMute(id, muted):
            return "\(name(home.media, id, \.name)) → \(muted ? L("muted") : L("unmuted"))"
        case let .mediaSource(id, sourceId):
            let zone = home.media.first { $0.id == id }
            return "\(zone?.name ?? id) → \(zone?.sources.first { $0.id == sourceId }?.name ?? sourceId)"
        case let .mediaTransport(id, action):
            let button: String
            switch action {
            case .play: button = L("Play")
            case .pause: button = L("Pause")
            case .next: button = L("Next")
            case .previous: button = L("Previous")
            }
            return "\(name(home.media, id, \.name)) → \(button)"
        case let .setLock(id, locked):
            let lock = name(home.locks, id, \.name)
            return locked ? L("Lock {name}", ["name": lock]) : L("Unlock {name}", ["name": lock])
        case let .setSecurity(id, mode, _):
            return "\(name(home.security, id, \.name)) → \(mode.label)"
        case let .gate(id, action):
            let vars = ["name": name(home.gates, id, \.name)]
            switch action {
            case .open: return L("Open {name}", vars)
            case .close: return L("Close {name}", vars)
            case .stop: return L("Stop {name}", vars)
            case .trigger: return L("Press {name}", vars)
            }
        case let .setClimate(id, target):
            let thermostat = home.climate.first { $0.id == id }
            return "\(thermostat?.name ?? id) → \(L10n.temp(thermostat?.clampTarget(target) ?? target))"
        case let .setMode(id, value):
            let mode = home.modes.first { $0.id == id }
            return "\(mode?.name ?? id) → \(mode?.options.first { $0.id == value }?.name ?? value)"
        case let .setSwitch(id, on):
            return "\(name(home.switches, id, \.name)) → \(on ? L("on") : L("off"))"
        case let .tvKey(id, key):
            return "\(name(home.media, id, \.name)) → \(key.rawValue)"
        case let .tvApp(id, appId):
            let zone = home.media.first { $0.id == id }
            return "\(zone?.name ?? id) → \(zone?.apps.first { $0.id == appId }?.name ?? appId)"
        case let .mediaChannel(id, channel):
            return "\(name(home.media, id, \.name)) → \(L("Channel {n}", ["n": String(channel)]))"
        }
    }

    /// A compact view of the house for the model: names, ids and state, plus what the person
    /// is looking at, the time, the weather and what is already scheduled.
    @MainActor
    static func homeForModel(_ home: HomeSnapshot, context: Context, automations: AutomationStore, now: Date = Date()) -> [String: Any] {
        var out = homeForModel(home)
        out["roomIds"] = home.rooms.map { (room: Room) -> [String: Any] in
            var entry: [String: Any] = ["id": room.id, "name": room.name]
            if let floor = room.floor { entry["floor"] = floor }
            return entry
        }
        if let room = context.viewingRoom { out["viewingRoom"] = room }
        let clock = DateFormatter()
        clock.locale = Locale(identifier: "en_US")
        clock.dateFormat = "EEEE h:mm a"
        out["localTime"] = clock.string(from: now)
        if let w = context.weather {
            out["weather"] = "\(w.temp)°\(w.unit.rawValue), high \(w.high)°, low \(w.low)°"
        }
        out["schedules"] = automations.schedules.map { (schedule: HomeSchedule) -> String in
            "\(schedule.name) (\(AutomationRules.describeWhen(schedule))\(schedule.enabled ? "" : ", off"))"
        }
        out["timers"] = automations.timers.map { (timer: HomeTimer) -> String in
            let minutes = max(1, Int((timer.at.timeIntervalSince(now) / 60).rounded()))
            return "\(timer.label) in \(minutes) min"
        }
        return out
    }

    /// The house part of the state: names, ids and state, nothing else.
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
        let media: [[String: Any]] = home.media.map { (zone: MediaZone) -> [String: Any] in
            let sources: [[String: Any]] = zone.sources.map { ["id": $0.id, "name": $0.name] }
            let apps: [[String: Any]] = zone.apps.map { ["id": $0.id, "name": $0.name] }
            var entry: [String: Any] = [
                "id": zone.id, "name": zone.name, "room": room(zone.roomId), "on": zone.isOn, "volume": pct(zone.volume), "muted": zone.isMuted,
                "source": zone.currentSource.map { $0.name as Any } ?? NSNull(), "sources": sources,
                "kind": zone.resolvedKind, "canRemote": zone.canRemote, "apps": apps,
            ]
            let channel: Any = zone.channel.map { (["number": $0.number, "name": $0.name] as [String: Any]) as Any } ?? NSNull()
            entry["channel"] = channel
            if let origin = zone.origin { entry["origin"] = origin }
            return entry
        }
        let locks: [[String: Any]] = home.locks.map { lock in
            let locked: Any = lock.isLocked.map { $0 as Any } ?? NSNull()
            return ["id": lock.id, "name": lock.name, "room": room(lock.roomId), "locked": locked]
        }
        let alarms: [[String: Any]] = home.security.map { ["id": $0.id, "name": $0.name, "mode": $0.mode.title] }
        let gates: [[String: Any]] = home.gates.map {
            ["id": $0.id, "name": $0.name, "state": $0.state.title, "separateOpenClose": $0.hasSeparateOpenClose]
        }
        let orNull = { (value: Any?) -> Any in value ?? NSNull() }
        let thermostats: [[String: Any]] = home.climate.map { (c: Climate) -> [String: Any] in
            var entry: [String: Any] = ["id": c.id, "name": c.name, "room": room(c.roomId)]
            entry["current"] = orNull(c.current)
            entry["target"] = orNull(c.target)
            entry["heating"] = orNull(c.heating)
            return entry
        }
        let modes: [[String: Any]] = home.modes.map { (m: HomeMode) -> [String: Any] in
            let options: [[String: Any]] = m.options.map { ["id": $0.id, "name": $0.name] }
            return ["id": m.id, "name": m.name, "value": orNull(m.value), "options": options]
        }
        let switches: [[String: Any]] = home.switches.map { (w: HomeSwitch) -> [String: Any] in
            var entry: [String: Any] = ["id": w.id, "name": w.name, "kind": w.kind, "room": room(w.roomId), "on": w.isOn]
            if let temperature = w.current { entry["temperature"] = temperature }
            return entry
        }
        return [
            "rooms": home.rooms.map(\.name), "lights": lights, "shades": shades, "scenes": scenes,
            "media": media, "locks": locks, "alarms": alarms, "gates": gates,
            "thermostats": thermostats, "modes": modes, "switches": switches,
        ]
    }
}
