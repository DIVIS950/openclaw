import SwiftUI
import UIKit

/// iPad: Home View (sidebar, wallpaper, Apple Home style tiles), made for a wall-mounted iPad.
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
                // iPad: Home View, in the appearance chosen in Settings.
                HVRoot()
                    .preferredColorScheme(settings.appearance.colorScheme)
            } else {
                // iPhone keeps the dark design.
                TabRoot()
                    .preferredColorScheme(.dark)
                    .tint(Theme.light)
            }
        }
        .overlay(alignment: .top) { if sizeClass != .regular { ErrorBanner() } }
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
