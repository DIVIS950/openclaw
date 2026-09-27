import RaceCore
import SwiftUI

struct SessionsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        NavigationStack {
            Group {
                if app.sessions.isEmpty {
                    ContentUnavailableView(
                        "No sessions yet", systemImage: "flag.checkered",
                        description: Text("Start a session in Drive. Laps, telemetry and video land here.")
                    )
                } else {
                    List {
                        ForEach(app.sessions) { s in
                            NavigationLink { SessionDetailView(sessionID: s.id) } label: { SessionRow(session: s) }
                                .listRowBackground(Theme.surface)
                        }
                        .onDelete { idx in idx.map { app.sessions[$0] }.forEach(app.delete) }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Theme.background)
            .navigationTitle("Sessions")
        }
    }
}

struct SessionRow: View {
    var session: Session

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(session.trackName).font(.headline).foregroundStyle(.white)
                Text("\(session.startDate.formatted(date: .abbreviated, time: .shortened)) · \(session.laps.count) laps"
                    + (session.vehicle.map { " · \($0.name)" } ?? ""))
                    .font(.caption).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            if session.video != nil { Image(systemName: "video.fill").foregroundStyle(Theme.textSecondary) }
            Text(session.bestLap.map { LapTimeFormat.string($0.time) } ?? "--")
                .font(Theme.mono(16)).foregroundStyle(Theme.personalBest)
        }
    }
}
