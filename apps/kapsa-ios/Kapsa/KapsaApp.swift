import SwiftUI
import UIKit
import UserNotifications

/// Kapsa: loyalty cards, gift cards and coupons that pop up by themselves when you
/// walk into the shop.
@main
struct KapsaApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = Store.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
        }
    }
}

/// Starts location watching early (iOS relaunches the app in the background when you
/// walk into a saved shop) and opens the right card when a notification is tapped.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        _ = LocationService.shared
        return true
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let raw = response.notification.request.content.userInfo["card"] as? String
        await MainActor.run {
            if let raw, let id = UUID(uuidString: raw) {
                Store.shared.open(cardID: id)
            }
        }
    }
}

struct RootView: View {
    @Environment(Store.self) private var store
    @Environment(\.scenePhase) private var scenePhase
    @State private var syncTask: Task<Void, Never>?

    var body: some View {
        @Bindable var store = store
        TabView(selection: $store.tab) {
            WalletView()
                .tabItem { Label(L("Karty", "Cards"), systemImage: "wallet.pass") }
                .tag(AppTab.wallet)
            CouponsView()
                .tabItem { Label(L("Kupóny", "Coupons"), systemImage: "ticket") }
                .tag(AppTab.coupons)
            StatsView()
                .tabItem { Label(L("Přehled", "Overview"), systemImage: "chart.bar") }
                .tag(AppTab.stats)
            SettingsView()
                .tabItem { Label(L("Nastavení", "Settings"), systemImage: "gearshape") }
                .tag(AppTab.settings)
        }
        .tint(Theme.accent)
        .preferredColorScheme(store.settings.followSystemDarkMode ? nil : .light)
        .sheet(item: $store.sheet) { sheet in
            SheetHost(sheet: sheet)
                .environment(store)
        }
        .fullScreenCover(item: $store.bigCode) { big in
            BigCodeView(big: big)
        }
        .overlay {
            ConfettiView(trigger: store.confetti).ignoresSafeArea()
        }
        .overlay(alignment: .bottom) {
            ToastView()
                .padding(.bottom, 64)
        }
        .onChange(of: scenePhase) {
            switch scenePhase {
            case .active:
                LocationService.shared.startUpdating()
            case .background:
                LocationService.shared.stopUpdating()
                store.saveNow()
            default:
                break
            }
        }
        .onChange(of: store.revision) {
            scheduleSync()
        }
        .task {
            scheduleSync()
            if store.settings.dwellOn || store.settings.expiryReminders {
                _ = await Notifier.requestPermission()
            }
        }
    }

    /// After changes settle: watch the right shop places and refresh expiry reminders.
    private func scheduleSync() {
        syncTask?.cancel()
        syncTask = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            LocationService.shared.syncRegions()
            let reminders = Notifier.expiryReminders(cards: store.cards, coupons: store.coupons, settings: store.settings)
            await Notifier.scheduleExpiry(reminders)
        }
    }
}

/// The message at the bottom ("Paid 120 Kč · Undo").
struct ToastView: View {
    @Environment(Store.self) private var store

    var body: some View {
        if let toast = store.toast {
            HStack(spacing: 12) {
                Text(toast.text)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                if let title = toast.actionTitle {
                    Button(title) {
                        toast.action?()
                        store.toast = nil
                    }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(Color(red: 1, green: 0.82, blue: 0.65))
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(Color.white.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                }
            }
            .padding(.leading, 18)
            .padding(.trailing, toast.actionTitle == nil ? 18 : 8)
            .padding(.vertical, 10)
            .background(Color(red: 0.23, green: 0.2, blue: 0.31), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 6)
            .padding(.horizontal, 16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(toast.id)
            .task(id: toast.id) {
                try? await Task.sleep(for: .seconds(toast.actionTitle == nil ? 2.6 : 6))
                if store.toast?.id == toast.id {
                    withAnimation {
                        store.toast = nil
                    }
                }
            }
        }
    }
}
