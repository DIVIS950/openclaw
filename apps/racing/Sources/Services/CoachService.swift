import AVFoundation
import Foundation
import Observation
import RaceCore

/// AI coach chat backed by the Claude Messages API (streamed over SSE).
@MainActor
@Observable
final class CoachService {
    struct ChatMessage: Identifiable, Equatable {
        let id = UUID()
        var role: String
        var text: String
        /// Hidden data-pack messages are sent to the model but shown as a short label.
        var label: String?
    }

    private(set) var messages: [ChatMessage] = []
    private(set) var isStreaming = false
    private(set) var error: String?
    var speakReplies = true

    let speech = Speech()
    @ObservationIgnored private var task: Task<Void, Never>?

    var apiKey: String {
        get { Keychain.get("anthropic_api_key") ?? "" }
        set { Keychain.set(newValue, for: "anthropic_api_key") }
    }

    var hasKey: Bool { !apiKey.isEmpty }

    func reset() {
        task?.cancel()
        speech.stop()
        messages = []
        error = nil
    }

    /// Send a user message. `label` replaces the (long) prompt in the chat UI.
    func send(_ text: String, label: String? = nil) {
        guard !isStreaming else { return }
        guard hasKey else {
            error = "Add your Anthropic API key in Settings to use the AI coach."
            return
        }
        error = nil
        messages.append(ChatMessage(role: "user", text: text, label: label))
        messages.append(ChatMessage(role: "assistant", text: ""))
        let history = messages.dropLast().map { ClaudeAPI.Message(role: $0.role, content: $0.text) }
        let request = ClaudeAPI.request(
            apiKey: apiKey,
            body: ClaudeAPI.requestBody(system: CoachPrompts.system, messages: Array(history))
        )
        isStreaming = true
        speech.stop()
        task = Task { [weak self] in
            await self?.stream(request)
        }
    }

    func stop() {
        task?.cancel()
        speech.stop()
        isStreaming = false
    }

    private func stream(_ request: URLRequest) async {
        defer { isStreaming = false }
        var spokenUpTo = 0
        do {
            let (bytes, response) = try await URLSession.shared.bytes(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                var body = ""
                for try await line in bytes.lines { body += line }
                throw NSError(domain: "Claude", code: http.statusCode, userInfo: [
                    NSLocalizedDescriptionKey: Self.describe(status: http.statusCode, body: body),
                ])
            }
            for try await line in bytes.lines {
                if Task.isCancelled { break }
                guard line.hasPrefix("data:") else { continue }
                let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                switch ClaudeAPI.decode(dataLine: payload) {
                case let .text(t)?:
                    appendToLast(t)
                    // Speak finished sentences as they stream in (low latency "radio" feel).
                    if speakReplies, let last = messages.last?.text {
                        spokenUpTo = speakCompleteSentences(in: last, from: spokenUpTo)
                    }
                case let .stop(reason)?:
                    if reason == "refusal" {
                        appendToLast("\n\n(The request was declined. Try rephrasing.)")
                    } else if reason == "max_tokens" {
                        appendToLast("…")
                    }
                case let .error(msg)?:
                    throw NSError(domain: "Claude", code: 0, userInfo: [NSLocalizedDescriptionKey: msg])
                case nil:
                    break
                }
            }
            if speakReplies, let last = messages.last?.text, spokenUpTo < last.count {
                speech.say(String(last.dropFirst(spokenUpTo)))
            }
        } catch is CancellationError {
        } catch {
            self.error = error.localizedDescription
            if messages.last?.role == "assistant", messages.last?.text.isEmpty == true { messages.removeLast() }
        }
    }

    private func appendToLast(_ t: String) {
        guard !messages.isEmpty else { return }
        messages[messages.count - 1].text += t
    }

    private func speakCompleteSentences(in text: String, from offset: Int) -> Int {
        let rest = text.dropFirst(offset)
        guard let end = rest.lastIndex(where: { ".!?\n".contains($0) }) else { return offset }
        let chunk = String(rest[...end])
        speech.say(chunk)
        return offset + chunk.count
    }

    private static func describe(status: Int, body: String) -> String {
        switch status {
        case 401: return "Invalid API key. Check it in Settings."
        case 429: return "Rate limited by the API. Try again in a moment."
        case 529, 500...599: return "The AI service is busy. Try again shortly."
        default:
            if let d = body.data(using: .utf8),
               let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
               let e = o["error"] as? [String: Any], let m = e["message"] as? String { return m }
            return "Request failed (\(status))."
        }
    }
}

/// Text-to-speech for coach replies and live lap/delta callouts. Ducks other audio (music, intercom).
final class Speech: NSObject {
    private let synth = AVSpeechSynthesizer()

    override init() {
        super.init()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .voicePrompt, options: [.duckOthers, .mixWithOthers])
    }

    func say(_ text: String, rate: Float = 0.52, interrupt: Bool = false) {
        let clean = text.replacingOccurrences(of: "#", with: "").replacingOccurrences(of: "*", with: "")
        guard !clean.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        if interrupt { synth.stopSpeaking(at: .immediate) }
        try? AVAudioSession.sharedInstance().setActive(true)
        let u = AVSpeechUtterance(string: clean)
        u.rate = rate
        u.voice = AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first ?? "en-US")
        synth.speak(u)
    }

    func stop() { synth.stopSpeaking(at: .immediate) }
}
