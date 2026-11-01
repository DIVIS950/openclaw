import Observation
import SwiftUI

/// The Ask Home conversation: what was said, what the house did, and Confirm buttons.
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
    }

    private(set) var log: [Entry] = []
    private(set) var busy = false
    @ObservationIgnored private var turns: [(role: String, text: String)] = []
    @ObservationIgnored private var task: Task<Void, Never>?

    func submit(_ raw: String, store: HomeStore, apiKey: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !busy else { return }
        busy = true
        log.append(Entry(kind: .me, text: text))
        let history = turns
        task = Task {
            defer { busy = false }
            do {
                let reply = try await HomeAssistant.run(message: text, history: history, store: store, apiKey: apiKey)
                log.append(Entry(kind: .answer, text: reply.text))
                if !reply.done.isEmpty || !reply.failed.isEmpty {
                    log.append(Entry(kind: .did, items: reply.done, failed: reply.failed))
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

    func cancel() {
        task?.cancel()
        task = nil
        busy = false
    }
}

/// Floating card at the bottom, like Siri: the conversation and a text field.
/// Speaking works with the microphone key on the iPad keyboard.
@MainActor
struct HVAskPanel: View {
    @Environment(HVAskModel.self) private var ask
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(HVNav.self) private var nav
    @State private var text = ""
    @FocusState private var focused: Bool

    private let suggestions = ["Good night", "Turn off all the lights", "Dim the living room to 30%",
                               "Is the front door locked?", "Play Spotify in the kitchen", "Open the gate"]

    var body: some View {
        let keyMissing = settings.assistantKey.trimmingCharacters(in: .whitespaces).isEmpty
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                HVOrb(size: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Ask Home").font(.headline)
                    Text("Type, or tap the mic on the keyboard").font(.footnote).foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    ask.cancel()
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { nav.askOpen = false }
                } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.secondary)
                        .frame(width: 34, height: 34).background(Circle().fill(Color.primary.opacity(0.1)))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel("Close Ask Home")
            }
            .padding([.horizontal, .top], 18)

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
                            Text("What would you like to do?").font(.title3.weight(.medium))
                            HVFlow(spacing: 8) {
                                ForEach(suggestions, id: \.self) { suggestion in
                                    Button { ask.submit(suggestion, store: store, apiKey: settings.assistantKey) } label: {
                                        Text(suggestion)
                                            .font(.subheadline.weight(.medium))
                                            .foregroundStyle(.primary)
                                            .padding(.horizontal, 14)
                                            .padding(.vertical, 9)
                                            .background(Capsule().fill(Color.primary.opacity(0.08)))
                                    }
                                    .buttonStyle(HVPress())
                                }
                            }
                        } else {
                            ForEach(ask.log) { entry in row(entry).id(entry.id) }
                            if ask.busy {
                                Text("Thinking…")
                                    .font(.title3.weight(.medium))
                                    .foregroundStyle(LinearGradient(colors: [.pink, .orange, .cyan, .indigo], startPoint: .leading, endPoint: .trailing))
                                    .id("thinking")
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                }
                .frame(maxHeight: 420)
                .fixedSize(horizontal: false, vertical: true)
                .onChange(of: ask.log.count) {
                    if let last = ask.log.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
                .onChange(of: ask.busy) {
                    if ask.busy { withAnimation { proxy.scrollTo("thinking", anchor: .bottom) } }
                }
            }

            HStack(spacing: 8) {
                TextField("Turn off the kitchen lights…", text: $text)
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
        .frame(maxWidth: 640)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).strokeBorder(.white.opacity(0.25), lineWidth: 0.5))
        .shadow(color: .black.opacity(0.28), radius: 40, y: 20)
        .padding(.horizontal, 16)
        .padding(.bottom, 20)
        .onAppear { if !keyMissing { focused = true } }
    }

    private func send() {
        ask.submit(text, store: store, apiKey: settings.assistantKey)
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
            HVFlow(spacing: 6) {
                ForEach(entry.items, id: \.self) { item in chip(item, symbol: "checkmark", color: .green) }
                ForEach(entry.failed, id: \.self) { item in chip(item, symbol: "xmark", color: .red) }
            }
        case .confirm:
            HStack {
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

    private func chip(_ text: String, symbol: String, color: Color) -> some View {
        HStack(spacing: 5) {
            Image(systemName: symbol).font(.caption.weight(.bold)).foregroundStyle(color)
            Text(text).font(.footnote.weight(.semibold))
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 6)
        .background(Capsule().fill(Color.primary.opacity(0.08)))
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
