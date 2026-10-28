import SwiftUI
import UIKit

/// iPad: sidebar + detail (works great mounted on the wall).
/// iPhone: tab bar.
@MainActor
struct RootView: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.scenePhase) private var scenePhase
    @State private var showSaver = false
    @State private var lastTouch = Date()

    var body: some View {
        Group {
            if sizeClass == .regular {
                SplitRoot()
            } else {
                TabRoot()
            }
        }
        .overlay(alignment: .top) { ErrorBanner() }
        .overlay {
            if showSaver {
                ScreensaverView {
                    withAnimation { showSaver = false }
                    lastTouch = Date()
                }
            }
        }
        // Any tap counts as activity for the screensaver timer.
        .simultaneousGesture(TapGesture().onEnded { lastTouch = Date() })
        .onAppear { applyKiosk() }
        .onChange(of: settings.kioskMode) { applyKiosk() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { applyKiosk() }
        }
        .task(id: settings.kioskMode) {
            guard settings.kioskMode else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(10))
                let idleSince = max(lastTouch, store.lastUserAction)
                if !showSaver && Date().timeIntervalSince(idleSince) > Double(settings.screensaverMinutes * 60) {
                    withAnimation(.easeInOut(duration: 1)) { showSaver = true }
                }
            }
        }
    }

    private func applyKiosk() {
        UIApplication.shared.isIdleTimerDisabled = settings.kioskMode
        if !settings.kioskMode { showSaver = false }
    }
}

private enum SidebarItem: Hashable {
    case home, rooms, lights, shades, media, security, cameras, settings
    case room(String)
}

@MainActor
private struct SplitRoot: View {
    @Environment(HomeStore.self) private var store
    @State private var selection: SidebarItem? = .home

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    row(.home, "Home", "house.fill")
                    row(.lights, "Lights", "lightbulb.fill")
                    row(.shades, "Shades", "blinds.horizontal.closed")
                    row(.media, "Media", "hifispeaker.2.fill")
                    row(.security, "Security & Gate", "shield.lefthalf.filled")
                    row(.cameras, "Cameras", "video.fill")
                }
                if !store.home.rooms.isEmpty {
                    Section("Rooms") {
                        ForEach(store.home.rooms) { room in
                            row(.room(room.id), room.name, Theme.roomSymbol(room.name))
                        }
                    }
                }
                Section {
                    row(.settings, "Settings", "gearshape.fill")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.backgroundTop.ignoresSafeArea())
            .navigationTitle("Home")
        } detail: {
            NavigationStack {
                switch selection ?? .home {
                case .home, .rooms: HomeDashboardView()
                case .lights: LightsView()
                case .shades: ShadesView()
                case .media: MediaView()
                case .security: SecurityView()
                case .cameras: CamerasView()
                case .settings: SettingsView()
                case let .room(id): RoomDetailView(roomId: id)
                }
            }
            // Reset the stack when switching sidebar items.
            .id(selection)
        }
        .navigationSplitViewStyle(.balanced)
    }

    private func row(_ item: SidebarItem, _ title: String, _ icon: String) -> some View {
        Label(title, systemImage: icon).tag(item)
    }
}

@MainActor
private struct TabRoot: View {
    @State private var showSettings = false

    var body: some View {
        TabView {
            NavigationStack { HomeDashboardView(openSettings: { showSettings = true }) }
                .tabItem { Label("Home", systemImage: "house.fill") }
            NavigationStack { RoomsView() }
                .tabItem { Label("Rooms", systemImage: "square.split.2x2.fill") }
            NavigationStack { MediaView() }
                .tabItem { Label("Media", systemImage: "hifispeaker.2.fill") }
            NavigationStack { SecurityView() }
                .tabItem { Label("Security", systemImage: "shield.lefthalf.filled") }
            NavigationStack { CamerasView() }
                .tabItem { Label("Cameras", systemImage: "video.fill") }
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack { SettingsView(isSheet: true) }
        }
    }
}

@MainActor
private struct ErrorBanner: View {
    @Environment(HomeStore.self) private var store

    var body: some View {
        if let message = store.commandError {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .background(Theme.alert.opacity(0.9), in: Capsule())
                .foregroundStyle(.white)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
        }
    }
}
