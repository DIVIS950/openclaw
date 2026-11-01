import SwiftUI

@main
@MainActor
struct HomeControlApp: App {
    @State private var settings = AppSettings()
    @State private var store = HomeStore()
    @State private var photos = RoomPhotos()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
                .environment(store)
                .environment(photos)
                .task { store.connect(using: settings) }
        }
    }
}
