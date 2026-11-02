import AVFoundation
import Observation
import SwiftUI

/// The Ask Home conversation: what was said, what the house did (with Undo), and Confirm
/// buttons. It can read its answers out loud.
@MainActor
@Observable
final class HVAskModel {
    struct Entry: Identifiable {
        enum Kind { case me, answer, problem, did, confirm }

        let id = UUID()
        var kind: Kind
        var text = ""
        var items: [String] = []
        var failed: [String] = []
        var command: HomeCommand?
        var done = false
        /// For a "did" card: the commands that put back the lights, shades and music the answer changed.
        var undo: [HomeCommand] = []
        var undone = false
    }

    /// A suggestion on the empty Ask Home card.
    struct Suggestion: Identifiable {
        let symbol: String
        let text: String
        var id: String { text }
    }

    private(set) var log: [Entry] = []
    private(set) var busy = false
    /// Read answers out loud. Kept per device.
    private(set) var speak = UserDefaults.standard.bool(forKey: "ask.speak")
    @ObservationIgnored private var turns: [(role: String, text: String)] = []
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var voice = AVSpeechSynthesizer()

    func submit(_ raw: String, store: HomeStore, automations: AutomationStore, context: HomeAssistant.Context, apiKey: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        busy = true
        voice.stopSpeaking(at: .immediate)
        log.append(Entry(kind: .me, text: text))
        let history = turns
        // The house before the answer, so Undo knows what to put back.
        let before = store.home
        task = Task {
            // After cancel() a newer request may own `busy`; leave it alone.
            defer { if !Task.isCancelled { busy = false } }
            do {
                let reply = try await HomeAssistant.run(message: text, history: history, store: store, automations: automations,
                                                        context: context, apiKey: apiKey)
                log.append(Entry(kind: .answer, text: reply.text))
                say(reply.text)
                if !reply.done.isEmpty || !reply.failed.isEmpty {
                    // Give the house a moment to report back before working out what Undo should restore.
                    try? await Task.sleep(for: .milliseconds(400))
                    let undo = Self.undoCommands(before: before, after: store.home)
                    log.append(Entry(kind: .did, items: reply.done, failed: reply.failed, undo: undo))
                }
                for item in reply.confirm {
                    log.append(Entry(kind: .confirm, text: item.label, command: item.command))
                }
                turns.append((role: "user", text: text))
                turns.append((role: "assistant", text: reply.text))
                turns = Array(turns.suffix(12))
            } catch is CancellationError {
                // Closed while thinking.
            } catch {
                log.append(Entry(kind: .problem, text: error.localizedDescription))
            }
        }
    }

    func confirm(_ id: UUID, store: HomeStore) {
        guard let index = log.firstIndex(where: { $0.id == id }), !log[index].done, let command = log[index].command else { return }
        store.perform(command)
        log[index].done = true
    }

    /// Puts back what one answer changed. Returns false when there was nothing to undo.
    @discardableResult
    func undo(_ id: UUID, store: HomeStore) -> Bool {
        guard let index = log.firstIndex(where: { $0.id == id }), !log[index].undone, !log[index].undo.isEmpty else { return false }
        for command in log[index].undo { store.perform(command) }
        log[index].undone = true
        return true
    }

    func toggleSpeak() {
        speak.toggle()
        UserDefaults.standard.set(speak, forKey: "ask.speak")
        if !speak { voice.stopSpeaking(at: .immediate) }
    }

    func cancel() {
        task?.cancel()
        task = nil
        busy = false
        voice.stopSpeaking(at: .immediate)
    }

    private func say(_ text: String) {
        guard speak, !text.isEmpty else { return }
        voice.stopSpeaking(at: .immediate)
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        voice.speak(utterance)
    }

    /// Commands that put back what an answer changed: lights, shades and music. Never locks,
    /// the gate or the alarm. Same as undoCommands in web/public/ipad/ask.js.
    static func undoCommands(before: HomeSnapshot, after: HomeSnapshot) -> [HomeCommand] {
        var commands: [HomeCommand] = []
        for light in before.lights {
            guard let now = after.lights.first(where: { $0.id == light.id }) else { continue }
            if abs(now.level - light.level) > 0.01 { commands.append(.setLight(id: light.id, level: light.level)) }
        }
        for shade in before.shades {
            guard let now = after.shades.first(where: { $0.id == shade.id }) else { continue }
            if abs(now.position - shade.position) > 0.01 { commands.append(.setShade(id: shade.id, position: shade.position)) }
        }
        for zone in before.media {
            guard let now = after.media.first(where: { $0.id == zone.id }) else { continue }
            if zone.isOn, let source = zone.currentSourceId, now.currentSourceId != source {
                commands.append(.mediaSource(zoneId: zone.id, sourceId: source))
            }
            if now.isOn != zone.isOn { commands.append(.mediaPower(zoneId: zone.id, on: zone.isOn)) }
            if zone.isOn && abs(now.volume - zone.volume) > 0.01 { commands.append(.mediaVolume(zoneId: zone.id, level: zone.volume)) }
        }
        return commands
    }

    /// Suggestions that fit the house right now: something unlocked, the room on screen, music
    /// playing, the time of day. Same as smartSuggestions in web/public/ipad/ask.js.
    static func suggestions(_ home: HomeSnapshot, room: Room?, now: Date = Date()) -> [Suggestion] {
        let hour = Calendar.current.component(.hour, from: now)
        var out: [Suggestion] = []
        let unlocked = home.locks.filter { $0.isLocked == false }
        if let first = unlocked.first {
            out.append(Suggestion(symbol: "lock.fill", text: unlocked.count > 1 ? "Lock all the doors" : "Lock the \(first.name.lowercased())"))
        }
        if let room {
            if home.lights(in: room.id).contains(where: \.isOn) {
                out.append(Suggestion(symbol: "lightbulb.slash", text: "Turn off the lights in here"))
            } else {
                out.append(Suggestion(symbol: "lightbulb.fill", text: "Turn on the lights in here"))
            }
        }
        if let playing = home.media.first(where: \.isOn) {
            out.append(Suggestion(symbol: "timer", text: "Turn off the \(playing.name.lowercased()) music in 30 minutes"))
        } else if !home.media.isEmpty {
            out.append(Suggestion(symbol: "music.note", text: "Play Spotify in the kitchen"))
        }
        let words: [String] = hour >= 20 || hour < 5 ? ["night"] : hour < 11 ? ["morning", "wake"] : ["welcome", "home"]
        let scene = home.scenes.first { candidate in
            let name = candidate.name.lowercased()
            return words.contains { name.contains($0) }
        }
        if let scene { out.append(Suggestion(symbol: Theme.sceneSymbol(scene), text: scene.name)) }
        if !home.shades.isEmpty { out.append(Suggestion(symbol: "calendar", text: "Close all shades at sunset every day")) }
        if home.lightsOnCount > 2 { out.append(Suggestion(symbol: "lightbulb.slash", text: "Turn off all the lights")) }
        out.append(Suggestion(symbol: "sparkles", text: "What's on right now?"))
        return Array(out.prefix(6))
    }
}

/// Floating card at the bottom, like Siri: the conversation and a text field.
/// Speaking works with the microphone key on the iPad keyboard.
@MainActor
struct HVAskPanel: View {
    @Environment(HVAskModel.self) private var ask
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AutomationStore.self) private var automations
    @Environment(WeatherStore.self) private var weather
    @Environment(HVNav.self) private var nav
    @State private var text = ""
    @FocusState private var focused: Bool

    /// The room on screen, if any: "here" in a request means this room.
    private var viewingRoom: Room? {
        guard case let .room(id) = nav.route else { return nil }
        return store.home.room(id)
    }

    var body: some View {
        let keyMissing = settings.assistantKey.trimmingCharacters(in: .whitespaces).isEmpty
        VStack(spacing: 0) {
            header

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if keyMissing {
                            Text("To use Ask Home, add an Anthropic API key in Settings › AI assistant.")
                                .font(.title3.weight(.medium))
                            HVWideButton(title: "Open Settings", symbol: "gearshape.fill", primary: true) {
                                nav.askOpen = false
                                nav.sheet = .settings
                            }
                            .frame(maxWidth: 240)
                        } else if ask.log.isEmpty {
                            hello
                        } else {
                            ForEach(ask.log) { entry in row(entry).id(entry.id) }
                            if ask.busy {
                                HVThinkingDots()
                                    .padding(.vertical, 6)
                                    .id("thinking")
                                    .accessibilityLabel("Thinking")
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                }
                .frame(maxHeight: 460)
                .fixedSize(horizontal: false, vertical: true)
                .onChange(of: ask.log.count) {
                    if let last = ask.log.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
                .onChange(of: ask.busy) {
                    if ask.busy { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
                }
            }

            HStack(spacing: 8) {
                TextField("Ask anything about the house…", text: $text)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .padding(.horizontal, 20)
                    .frame(height: 48)
                    .background(Capsule().fill(Color.primary.opacity(0.08)))
                    .disabled(keyMissing)
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(Circle().fill(Color.blue))
                }
                .buttonStyle(HVPress())
                .disabled(keyMissing || ask.busy || text.trimmingCharacters(in: .whitespaces).isEmpty)
                .opacity(keyMissing || ask.busy ? 0.4 : 1)
                .accessibilityLabel("Send")
            }
            .padding([.horizontal, .bottom], 12)
        }
        .frame(maxWidth: 720)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).strokeBorder(.white.opacity(0.25), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.28), radius: 40, y: 20)
        .padding(.horizontal, 16)
        .padding(.bottom, 20)
        .onAppear { if !keyMissing { focused = true } }
    }

    private var header: some View {
        HStack(spacing: 12) {
            HVOrb(size: 38)
            VStack(alignment: .leading, spacing: 3) {
                Text("Ask Home").font(.title3.weight(.bold))
                HStack(spacing: 6) {
                    if let room = viewingRoom {
                        Label("In \(room.name)", systemImage: "house.fill")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.blue)
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .padding(.vertical, 3)
                            .background(Capsule().fill(Color.blue.opacity(0.16)))
                    }
                    Text("Type, or tap the mic on the keyboard")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            Spacer(minLength: 8)
            Button { ask.toggleSpeak() } label: {
                Image(systemName: ask.speak ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(ask.speak ? Color.white : Color.secondary)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(ask.speak ? Color.blue : Color.primary.opacity(0.1)))
            }
            .buttonStyle(HVPress())
            .accessibilityLabel("Read answers out loud")
            .accessibilityAddTraits(ask.speak ? .isSelected : [])
            Button {
                ask.cancel()
                withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { nav.askOpen = false }
            } label: {
                Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.secondary)
                    .frame(width: 36, height: 36).background(Circle().fill(Color.primary.opacity(0.1)))
            }
            .buttonStyle(HVPress())
            .accessibilityLabel("Close Ask Home")
        }
        .padding([.horizontal, .top], 18)
    }

    /// Before the first question: a greeting, what Ask Home can do, and ideas that fit the house now.
    private var hello: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(HVHomePager.greeting(Date())). What can I do for you?").font(.title3.weight(.medium))
            Text("I can control anything in the house, set timers (\"in 30 minutes\") and schedules (\"every night at 11\"), and answer questions.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 8)], spacing: 8) {
                ForEach(HVAskModel.suggestions(store.home, room: viewingRoom)) { suggestion in
                    Button { submit(suggestion.text) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: suggestion.symbol)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(width: 32, height: 32)
                                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(HV.askAccent))
                            Text(suggestion.text)
                                .font(.subheadline.weight(.medium))
                                .multilineTextAlignment(.leading)
                                .lineLimit(2)
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(.primary)
                        .padding(12)
                        .frame(maxWidth: .infinity, minHeight: 58, alignment: .leading)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.primary.opacity(0.07)))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.primary.opacity(0.08), lineWidth: 0.5))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(HVPress())
                }
            }
        }
    }

    private func context() -> HomeAssistant.Context {
        HomeAssistant.Context(viewingRoom: viewingRoom?.name, weather: weather.weather)
    }

    private func submit(_ request: String) {
        ask.submit(request, store: store, automations: automations, context: context(), apiKey: settings.assistantKey)
    }

    private func send() {
        submit(text)
        text = ""
    }

    @ViewBuilder
    private func row(_ entry: HVAskModel.Entry) -> some View {
        switch entry.kind {
        case .me:
            Text(entry.text)
                .font(.body)
                .foregroundStyle(.white)
                .padding(.horizontal, 15)
                .padding(.vertical, 9)
                .background(UnevenRoundedRectangle(topLeadingRadius: 20, bottomLeadingRadius: 20, bottomTrailingRadius: 6, topTrailingRadius: 20, style: .continuous).fill(Color.blue))
                .frame(maxWidth: .infinity, alignment: .trailing)
        case .answer:
            Text(entry.text).font(.title3.weight(.medium)).textSelection(.enabled)
        case .problem:
            Label(entry.text, systemImage: "exclamationmark.triangle.fill").font(.body.weight(.semibold)).foregroundStyle(.red)
        case .did:
            didCard(entry)
        case .confirm:
            HStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill").font(.body.weight(.semibold)).foregroundStyle(.orange)
                Text(entry.text).font(.body.weight(.semibold))
                Spacer()
                if entry.done {
                    Label("Done", systemImage: "checkmark").font(.body.weight(.semibold)).foregroundStyle(.green)
                } else {
                    Button { ask.confirm(entry.id, store: store) } label: {
                        Text("Confirm")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 9)
                            .background(Capsule().fill(Color.blue))
                    }
                    .buttonStyle(HVPress())
                }
            }
            .padding(.leading, 16)
            .padding(.trailing, 12)
            .padding(.vertical, 12)
            .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.primary.opacity(0.08)))
        }
    }

    /// What the answer did, one line each, with Undo for the lights, shades and music it changed.
    private func didCard(_ entry: HVAskModel.Entry) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(Array(entry.items.enumerated()), id: \.offset) { _, item in
                didRow(item, symbol: "checkmark", color: .green)
            }
            ForEach(Array(entry.failed.enumerated()), id: \.offset) { _, item in
                didRow(item, symbol: "xmark", color: .red)
            }
            if !entry.undo.isEmpty {
                Button {
                    if ask.undo(entry.id, store: store) {
                        nav.notify("Put back as it was", symbol: "arrow.uturn.backward", color: .blue)
                    }
                } label: {
                    Label(entry.undone ? "Undone" : "Undo", systemImage: "arrow.uturn.backward")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.black)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(Color.white).shadow(color: .black.opacity(0.1), radius: 3, y: 1))
                }
                .buttonStyle(HVPress())
                .disabled(entry.undone)
                .opacity(entry.undone ? 0.5 : 1)
                .padding(.top, 3)
                .accessibilityHint("Puts the lights, shades and music back as they were")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Color.primary.opacity(0.08)))
    }

    private func didRow(_ text: String, symbol: String, color: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).font(.footnote.weight(.heavy)).foregroundStyle(color)
            Text(text).font(.subheadline.weight(.semibold))
        }
    }
}

extension HV {
    /// The blue-to-pink of the Ask Home suggestion icons and thinking dots.
    static let askAccent = LinearGradient(colors: [Color(red: 0.48, green: 0.48, blue: 1), Color(red: 1, green: 0.37, blue: 0.64)],
                                          startPoint: .topLeading, endPoint: .bottomTrailing)
}

/// Three dots hopping one after the other while Ask Home thinks.
struct HVThinkingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 5) {
                ForEach(0..<3, id: \.self) { i in
                    let hop = reduceMotion ? 0 : Self.hop(t - Double(i) * 0.15)
                    Circle()
                        .fill(HV.askAccent)
                        .frame(width: 9, height: 9)
                        .offset(y: CGFloat(-6 * hop))
                        .opacity(1 - 0.3 * hop)
                }
            }
        }
    }

    /// 0…1…0 during the first 60% of each 1.1-second beat, then rest.
    private static func hop(_ t: Double) -> Double {
        let phase = t.truncatingRemainder(dividingBy: 1.1) / 1.1
        return phase < 0.6 ? sin(phase / 0.6 * Double.pi) : 0
    }
}

/// The glowing screen edge while Ask Home is open.
struct HVGlow: View {
    var busy: Bool
    @State private var turn = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Rectangle()
            .strokeBorder(AngularGradient(colors: [.pink, .orange, .yellow, .cyan, .indigo, .purple, .pink], center: .center), lineWidth: busy ? 12 : 8)
            .blur(radius: 10)
            .hueRotation(.degrees(turn ? 360 : 0))
            .ignoresSafeArea()
            .allowsHitTesting(false)
            .animation(.easeInOut(duration: 0.4), value: busy)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 5).repeatForever(autoreverses: false)) { turn = true }
            }
            .accessibilityHidden(true)
    }
}

/// Lays its children out in rows, wrapping like words in a sentence.
struct HVFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += row + spacing
                row = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            row = max(row, size.height)
        }
        return CGSize(width: min(widest, width), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += row + spacing
                row = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}
