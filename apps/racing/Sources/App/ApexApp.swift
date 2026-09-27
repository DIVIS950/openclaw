import SwiftUI

@main
struct ApexApp: App {
    @State private var app = AppModel()

    var body: some Scene {
        WindowGroup {
            TabView {
                LiveTab().tabItem { Label("Drive", systemImage: "speedometer") }
                TracksView().tabItem { Label("Tracks", systemImage: "map") }
                SessionsView().tabItem { Label("Sessions", systemImage: "chart.xyaxis.line") }
                CoachView().tabItem { Label("Coach", systemImage: "sparkles") }
                SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .tint(Theme.accent)
            .environment(app)
            .preferredColorScheme(.dark)
        }
    }
}
