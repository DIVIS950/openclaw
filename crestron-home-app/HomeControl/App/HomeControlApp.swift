import SwiftUI

@main
@MainActor
struct HomeControlApp: App {
    @State private var settings = AppSettings()
    @State private var store = HomeStore()
    @State private var photos = RoomPhotos()
    @State private var automations = AutomationStore()
    @State private var weather = WeatherStore()
    @State private var layout = HomeLayout()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
                .environment(store)
                .environment(photos)
                .environment(automations)
                .environment(weather)
                .environment(layout)
                .task {
                    store.connect(using: settings)
                    automations.seedDemoIfNew(mode: settings.mode)
                    automations.start(store: store, settings: settings)
                }
        }
    }
}
