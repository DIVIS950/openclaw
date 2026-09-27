import Foundation

/// Builds the data packs and prompts for the AI race engineer / driving coach.
/// The model gets compact, factual JSON (corner metrics, speeds, brake points) rather than raw
/// telemetry so the advice is specific ("brake 12 m later into T4") instead of generic.
public enum CoachPrompts {
    public static let system = """
    You are Apex, an elite motorsport driving coach and race engineer for cars and karts \
    (track days, club racing, karting, sim racing). You speak to the driver directly, like a \
    trusted coach on the radio: clear, confident, specific, encouraging, never vague.

    Rules:
    - Ground every statement in the data provided (corner numbers, distances in meters, speeds \
    in km/h, time in seconds). If data is missing, say what you are assuming.
    - Use corner numbers from the data (T1, T2...) and famous corner names when you know them \
    for this track.
    - Distances like "brake point 420 m" are meters along the reference lap from start/finish. \
    Translate them into practical cues ("about 10 m later", "one marker board later").
    - Prioritise: the biggest time gains first, max 3 focus points per session. Beginners get \
    fewer, simpler points.
    - Kart specifics: minimum speed, momentum, avoiding scrubbing, early apex rarely pays, \
    weight shifting. Car specifics: trail braking, rotation, traction on exit, tyre temps.
    - Safety beats lap time. Never encourage risk on unfamiliar or wet tracks; mention flags, \
    runoff and cool-down laps where relevant.
    - Output is read aloud as well as shown: short sentences, no tables, no markdown headings \
    deeper than ##, no emoji.
    """

    public struct CornerBrief: Codable, Sendable {
        public var corner: String
        public var direction: String
        public var brakePoint_m: Int
        public var apex_m: Int
        public var entry_kmh: Int
        public var min_kmh: Int
        public var exit_kmh: Int
        public var maxLatG: Double
        public var peakBrakeG: Double
        public var time_s: Double
    }

    public struct CornerDiff: Codable, Sendable {
        public var corner: String
        public var direction: String
        public var timeLoss_s: Double
        public var brakePointDiff_m: Int     // + = braked later than reference
        public var minSpeedDiff_kmh: Int
        public var exitSpeedDiff_kmh: Int
        public var entrySpeedDiff_kmh: Int
        public var peakBrakeG: Double
        public var refPeakBrakeG: Double
    }

    static func r2(_ x: Double) -> Double { (x * 100).rounded() / 100 }

    public static func cornerBriefs(_ ref: ReferenceLap) -> [CornerBrief] {
        let corners = LapAnalysis.detectCorners(in: ref)
        let pts = LapAnalysis.align(ref.lap, to: ref)
        return corners.compactMap { c in
            guard let m = LapAnalysis.metrics(pts, corner: c) else { return nil }
            return CornerBrief(
                corner: "T\(c.number)", direction: c.direction.rawValue,
                brakePoint_m: Int(m.brakePoint), apex_m: Int(c.apex),
                entry_kmh: Int(m.entrySpeed * 3.6), min_kmh: Int(m.minSpeed * 3.6), exit_kmh: Int(m.exitSpeed * 3.6),
                maxLatG: r2(m.maxLatG), peakBrakeG: r2(m.peakBrakeG), time_s: r2(m.time)
            )
        }
    }

    public static func cornerDiffs(_ comps: [CornerComparison]) -> [CornerDiff] {
        comps.map { c in
            CornerDiff(
                corner: "T\(c.corner.number)", direction: c.corner.direction.rawValue,
                timeLoss_s: r2(c.timeLoss),
                brakePointDiff_m: Int(c.lap.brakePoint - c.reference.brakePoint),
                minSpeedDiff_kmh: Int((c.lap.minSpeed - c.reference.minSpeed) * 3.6),
                exitSpeedDiff_kmh: Int((c.lap.exitSpeed - c.reference.exitSpeed) * 3.6),
                entrySpeedDiff_kmh: Int((c.lap.entrySpeed - c.reference.entrySpeed) * 3.6),
                peakBrakeG: r2(c.lap.peakBrakeG), refPeakBrakeG: r2(c.reference.peakBrakeG)
            )
        }
    }

    static func json<T: Encodable>(_ v: T) -> String {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return (try? e.encode(v)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    static func trackHeader(_ track: Track, vehicle: Vehicle?) -> String {
        var s = "Track: \(track.name) (\(track.country)), \(track.kind.rawValue), length \(Int(track.length)) m."
        if !track.notes.isEmpty { s += "\nTrack notes: \(track.notes)" }
        if let v = vehicle {
            s += "\nVehicle: \(v.name) [\(v.vehicleClass.rawValue)]"
            if !v.setup.isEmpty { s += " — \(v.setup)" }
        }
        return s
    }

    /// Pre-session briefing: walk the track, the ideal line and the plan.
    public static func briefing(
        track: Track, vehicle: Vehicle?, reference: ReferenceLap?, lastDebrief: String?,
        goal: String, conditions: String
    ) -> String {
        var s = "PRE-SESSION BRIEFING REQUEST\n" + trackHeader(track, vehicle: vehicle)
        if !conditions.isEmpty { s += "\nConditions: \(conditions)" }
        if !goal.isEmpty { s += "\nDriver goal: \(goal)" }
        if let ref = reference {
            s += "\nDriver's reference lap: \(LapTimeFormat.string(ref.lapTime)) over \(Int(ref.totalDistance)) m."
            s += "\nCorner data from that lap (distances along the lap from start/finish):\n"
            s += json(cornerBriefs(ref))
        } else {
            s += "\nNo previous laps here: this is the driver's first session at this track."
        }
        if let d = lastDebrief, !d.isEmpty {
            s += "\nPrevious debrief summary:\n\(d.prefix(1500))"
        }
        s += """

        \nGive a spoken briefing (about 2-3 minutes read aloud):
        1. The character of the track and what wins lap time here.
        2. A lap walk-through corner by corner: braking reference, turn-in, apex, exit, gear/speed \
        feel, and the ideal line (early/late apex, using all the track on exit, compromise corners).
        3. The 3 focus points for this session, and a plan for the first laps (warm tyres/brakes, \
        build up in steps).
        """
        return s
    }

    /// Post-session debrief with where time was lost and what to change.
    public static func debrief(
        track: Track, vehicle: Vehicle?, session: Session, reference: ReferenceLap,
        compareLap: Lap, comparisons: [CornerComparison]
    ) -> String {
        let valid = session.laps.filter(\.isValid)
        let times = valid.map(\.time)
        let mean = times.isEmpty ? 0 : times.reduce(0, +) / Double(times.count)
        let sd = times.isEmpty ? 0 : (times.map { ($0 - mean) * ($0 - mean) }.reduce(0, +) / Double(times.count)).squareRoot()
        var s = "POST-SESSION DEBRIEF REQUEST\n" + trackHeader(track, vehicle: vehicle)
        if !session.conditions.isEmpty { s += "\nConditions: \(session.conditions)" }
        s += "\nLaps: " + valid.map { "L\($0.number) \(LapTimeFormat.string($0.time))" }.joined(separator: ", ")
        if let tb = session.theoreticalBest { s += "\nTheoretical best (best sectors): \(LapTimeFormat.string(tb))" }
        s += String(format: "\nConsistency: mean %.3f s, std dev %.3f s", mean, sd)
        s += "\nReference lap: L\(reference.lap.number) \(LapTimeFormat.string(reference.lapTime))."
        s += "\nCompared lap: L\(compareLap.number) \(LapTimeFormat.string(compareLap.time))."
        s += "\nPer-corner differences of the compared lap vs reference (+timeLoss = slower; +brakePointDiff = braked later; negative speed diff = slower):\n"
        s += json(cornerDiffs(comparisons))
        s += "\nReference corner data:\n" + json(cornerBriefs(reference))
        if !session.notes.isEmpty { s += "\nDriver notes: \(session.notes)" }
        s += """

        \nDebrief the driver:
        1. One-line summary of the session.
        2. The 3 corners where the most time is being lost, with the likely cause read from the \
        data (braking too early/late, over-slowing the minimum speed, poor exit / late throttle, \
        wide line), and exactly what to do differently next time.
        3. What went well (keep doing).
        4. A concrete plan for the next session.
        """
        return s
    }
}

// MARK: - Claude Messages API wire format (raw HTTP; there is no official Swift SDK)

public enum ClaudeAPI {
    public static let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!
    public static let model = "claude-opus-5"
    public static let version = "2023-06-01"
    /// Server-side refusal fallback ("default" routing picks the recommended fallback model).
    public static let fallbackBeta = "server-side-fallback-2026-07-01"

    public struct Message: Codable, Sendable, Equatable {
        public var role: String // "user" | "assistant"
        public var content: String

        public init(role: String, content: String) {
            self.role = role
            self.content = content
        }
    }

    public static func requestBody(system: String, messages: [Message], maxTokens: Int = 16000) -> Data {
        let body: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "stream": true,
            "thinking": ["type": "adaptive"],
            "fallbacks": "default",
            // Cache the large, stable system prompt across the chat.
            "system": [["type": "text", "text": system, "cache_control": ["type": "ephemeral"]]],
            "messages": messages.map { ["role": $0.role, "content": $0.content] },
        ]
        return (try? JSONSerialization.data(withJSONObject: body)) ?? Data()
    }

    public static func request(apiKey: String, body: Data) -> URLRequest {
        var r = URLRequest(url: endpoint)
        r.httpMethod = "POST"
        r.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        r.setValue(version, forHTTPHeaderField: "anthropic-version")
        r.setValue(fallbackBeta, forHTTPHeaderField: "anthropic-beta")
        r.setValue("application/json", forHTTPHeaderField: "content-type")
        r.httpBody = body
        r.timeoutInterval = 600
        return r
    }

    /// Decoded server-sent event of interest.
    public enum StreamEvent: Equatable, Sendable {
        case text(String)
        case stop(reason: String)
        case error(String)
    }

    /// Decodes one SSE `data:` line payload. Thinking deltas and bookkeeping events are ignored.
    public static func decode(dataLine: String) -> StreamEvent? {
        guard let data = dataLine.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String
        else { return nil }
        switch type {
        case "content_block_delta":
            if let d = obj["delta"] as? [String: Any], d["type"] as? String == "text_delta", let t = d["text"] as? String {
                return .text(t)
            }
        case "message_delta":
            if let d = obj["delta"] as? [String: Any], let r = d["stop_reason"] as? String {
                return .stop(reason: r)
            }
        case "error":
            let msg = (obj["error"] as? [String: Any])?["message"] as? String ?? "Unknown error"
            return .error(msg)
        default:
            break
        }
        return nil
    }
}
