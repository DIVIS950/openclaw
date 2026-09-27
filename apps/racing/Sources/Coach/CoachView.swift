import RaceCore
import SwiftUI

/// Chat with the AI coach. Briefings and debriefs are started from Drive / Sessions and land here too.
struct CoachView: View {
    @Environment(AppModel.self) private var app
    @State private var input = ""

    var body: some View {
        NavigationStack {
            CoachChat(coach: app.coach, input: $input)
                .background(Theme.background)
                .navigationTitle("AI Coach")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Toggle("Read replies aloud", isOn: Binding(get: { app.coach.speakReplies }, set: { app.coach.speakReplies = $0 }))
                            Button("New conversation", role: .destructive) { app.coach.reset() }
                        } label: { Image(systemName: "ellipsis.circle") }
                    }
                }
        }
    }
}

struct CoachChat: View {
    var coach: CoachService
    @Binding var input: String

    private let suggestions = [
        "How do I trail brake properly?",
        "My kart understeers on entry, what should I change in my driving?",
        "How do I learn a new track quickly and safely?",
        "Explain late apex vs early apex",
    ]

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if coach.messages.isEmpty {
                            intro
                        }
                        ForEach(coach.messages) { m in
                            bubble(m).id(m.id)
                        }
                        if let e = coach.error {
                            Label(e, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(Theme.warning)
                        }
                    }
                    .padding()
                }
                .onChange(of: coach.messages.last?.text) { _, _ in
                    if let id = coach.messages.last?.id { proxy.scrollTo(id, anchor: .bottom) }
                }
            }
            inputBar
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: "headphones").font(.system(size: 40)).foregroundStyle(Theme.accent)
            Text("Your race engineer").font(.title2.bold())
            Text("Ask anything about lines, braking, kart or car technique. For a track briefing tap “AI briefing” in Drive; after a session tap “AI debrief” and I’ll go through your data corner by corner.")
                .foregroundStyle(Theme.textSecondary)
            ForEach(suggestions, id: \.self) { s in
                Button { coach.send(s) } label: {
                    Text(s).font(.subheadline).padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func bubble(_ m: CoachService.ChatMessage) -> some View {
        let user = m.role == "user"
        return HStack {
            if user { Spacer(minLength: 40) }
            Group {
                if user, let label = m.label {
                    Label(label, systemImage: "doc.text.magnifyingglass")
                } else if m.text.isEmpty {
                    ProgressView().tint(.white)
                } else {
                    Text((try? AttributedString(markdown: m.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(m.text))
                }
            }
            .padding(12)
            .background(user ? Theme.accent : Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .foregroundStyle(.white)
            .textSelection(.enabled)
            if !user { Spacer(minLength: 20) }
        }
    }

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Ask your coach…", text: $input, axis: .vertical)
                .lineLimit(1...5)
                .padding(10)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
            if coach.isStreaming {
                Button { coach.stop() } label: { Image(systemName: "stop.circle.fill").font(.title) }
            } else {
                Button {
                    let t = input.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !t.isEmpty else { return }
                    coach.send(t)
                    input = ""
                } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
            }
        }
        .tint(Theme.accent)
        .padding(10)
        .background(Theme.background)
    }
}

/// Pre-session briefing: ideal line on the map + spoken walk-through, then follow-up questions.
struct BriefingSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let track: Track
    @State private var goal = ""
    @State private var conditions = "Dry"
    @State private var started = false
    @State private var input = ""

    private var bestLap: Lap? { app.bestLap(trackID: track.id, vehicleClass: app.selectedVehicle?.vehicleClass) }
    private var reference: ReferenceLap? { bestLap.map { ReferenceLap(lap: $0, projection: track.projection) } }

    /// Ideal line from all laps at this track (best segment per corner).
    private var ideal: [GeoPoint] {
        guard let ref = reference else { return [] }
        let laps = app.sessions(for: track.id).flatMap(\.laps)
        return LapAnalysis.idealLine(laps: laps, reference: ref).path
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TrackMap(track: track, lines: [], ideal: ideal).frame(height: started ? 200 : 260)
                if started {
                    CoachChat(coach: app.coach, input: $input)
                } else {
                    Form {
                        Section("Session") {
                            TextField("Goal (e.g. learn the track, beat 1:52, work on T1 braking)", text: $goal, axis: .vertical)
                            TextField("Conditions (dry / damp / wet, temperature)", text: $conditions)
                        }
                        Section {
                            Text(reference == nil
                                 ? "No laps here yet: the coach will brief you on the layout and a safe build-up plan."
                                 : "Using your best lap (\(LapTimeFormat.string(reference!.lapTime))) for corner-by-corner brake points and speeds. Dashed purple = your ideal line.")
                                .font(.footnote).foregroundStyle(Theme.textSecondary)
                        }
                        Button("Brief me") { startBriefing() }.buttonStyle(PrimaryButtonStyle())
                            .listRowBackground(Color.clear)
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.background)
            .navigationTitle("Briefing · \(track.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { app.coach.speech.stop(); dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }

    private func startBriefing() {
        let lastDebrief = app.sessions(for: track.id).first?.debrief
        let prompt = CoachPrompts.briefing(
            track: track, vehicle: app.selectedVehicle, reference: reference,
            lastDebrief: lastDebrief, goal: goal, conditions: conditions
        )
        app.coach.reset()
        app.coach.send(prompt, label: "Briefing request · \(track.name)")
        started = true
    }
}

/// Post-session debrief driven by the corner analysis.
struct DebriefSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let track: Track
    let session: Session
    let analysis: SessionDetailView.Analysis
    @State private var input = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TrackMap(track: track, lines: analysis.lap.samples.map(\.position), ideal: analysis.ideal.path,
                         highlight: worstCorner?.corner.apexPosition)
                    .frame(height: 200)
                CoachChat(coach: app.coach, input: $input)
            }
            .background(Theme.background)
            .navigationTitle("Debrief")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { saveAndClose() } } }
            .onAppear(perform: start)
        }
        .preferredColorScheme(.dark)
    }

    private var worstCorner: CornerComparison? { analysis.corners.max { $0.timeLoss < $1.timeLoss } }

    private func start() {
        // When comparing the best lap with itself, debrief the average lap against the best instead.
        var lap = analysis.lap
        if lap.id == analysis.reference.lap.id {
            let others = session.laps.filter { $0.isValid && $0.id != lap.id }
            let mean = others.map(\.time).reduce(0, +) / Double(max(others.count, 1))
            if let typical = others.min(by: { abs($0.time - mean) < abs($1.time - mean) }) { lap = typical }
        }
        let comps = lap.id == analysis.lap.id ? analysis.corners : LapAnalysis.compare(lap, reference: analysis.reference)
        let prompt = CoachPrompts.debrief(
            track: track, vehicle: session.vehicle, session: session, reference: analysis.reference,
            compareLap: lap, comparisons: comps
        )
        app.coach.reset()
        app.coach.send(prompt, label: "Debrief request · L\(lap.number) vs L\(analysis.reference.lap.number)")
    }

    private func saveAndClose() {
        app.coach.speech.stop()
        if let reply = app.coach.messages.first(where: { $0.role == "assistant" })?.text, !reply.isEmpty,
           var s = app.sessions.first(where: { $0.id == session.id })
        {
            s.debrief = reply
            app.save(s)
        }
        dismiss()
    }
}
