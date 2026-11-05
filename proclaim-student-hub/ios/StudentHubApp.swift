// Student Hub as an iPhone and iPad app.
//
// Swift Playgrounds (iPad or Mac):
//   1. Make a new "App".
//   2. Open MyApp.swift, delete everything in it and paste this whole file.
//   3. App Settings > Capabilities: add Camera and Microphone (photos and voice).
//   4. Press Run.
//
// Xcode (Mac): New Project > iOS > App (SwiftUI). Replace everything in
// <YourName>App.swift with this file. In the target's Info tab add
// "Privacy - Camera Usage Description" and "Privacy - Microphone Usage
// Description". Then Run.
//
// The app opens the hub full screen. When the hub asks for notifications,
// iPhone asks you once; after that the hub's reminders arrive as normal
// iPhone notifications.

import SwiftUI
import UIKit
import UserNotifications
import WebKit

/// The page this app opens.
let hubAddress = URL(string: "https://divis950.github.io/openclaw/hub/")!

@main
struct StudentHubApp: App {
    /// Shows reminders even while the app is open.
    private let relay = NotificationRelay()

    init() {
        UNUserNotificationCenter.current().delegate = relay
    }

    var body: some Scene {
        WindowGroup {
            HubScreen()
        }
    }
}

// MARK: - Screen

struct HubScreen: View {
    @State private var failed = false
    @State private var reloadKey = 0

    var body: some View {
        ZStack {
            Color(uiColor: .hubBackground).ignoresSafeArea()
            HubWebView(failed: $failed, reloadKey: reloadKey)
                .ignoresSafeArea()
            if failed {
                VStack(spacing: 12) {
                    Image(systemName: "wifi.slash").font(.largeTitle)
                    Text("Can't reach Student Hub").font(.headline)
                    Text("Check the internet, then try again.")
                        .foregroundStyle(.secondary)
                    Button("Try again") {
                        failed = false
                        reloadKey += 1
                    }
                    .buttonStyle(.borderedProminent)
                }
                .padding(28)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 22))
                .padding(24)
            }
        }
    }
}

extension UIColor {
    /// The hub's own background, so there is no white flash while it loads.
    static var hubBackground: UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(red: 0.059, green: 0.055, blue: 0.102, alpha: 1)
                : UIColor(red: 0.965, green: 0.953, blue: 1.0, alpha: 1)
        }
    }
}

// MARK: - Web view

struct HubWebView: UIViewRepresentable {
    @Binding var failed: Bool
    var reloadKey: Int

    func makeCoordinator() -> HubCoordinator {
        HubCoordinator(failed: $failed)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "StudentHubApp"
        config.userContentController.addScriptMessageHandler(
            context.coordinator, contentWorld: .page, name: "hub")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        // The hub places itself around the notch and home bar.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .hubBackground
        webView.scrollView.backgroundColor = .hubBackground
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        context.coordinator.webView = webView
        context.coordinator.start()
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.failed = $failed
        if reloadKey != context.coordinator.reloadKey {
            context.coordinator.reloadKey = reloadKey
            if webView.url == nil {
                webView.load(URLRequest(url: hubAddress))
            } else {
                webView.reload()
            }
        }
    }
}

@MainActor
final class HubCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate,
    WKScriptMessageHandlerWithReply
{
    var failed: Binding<Bool>
    var reloadKey = 0
    weak var webView: WKWebView?

    init(failed: Binding<Bool>) {
        self.failed = failed
        super.init()
        // Notifications may have been switched on or off in Settings meanwhile.
        NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in await self?.refreshPermission() }
        }
    }

    /// Tells the page what iPhone allows, then opens the hub.
    func start() {
        Task {
            await refreshPermission()
            webView?.load(URLRequest(url: hubAddress))
        }
    }

    private func refreshPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        installBridge(permission: permissionWord(settings.authorizationStatus))
    }

    private func installBridge(permission: String) {
        guard let webView else { return }
        let controller = webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(
            WKUserScript(
                source: notificationBridge(permission: permission),
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        // The page that is already open hears it too.
        webView.evaluateJavaScript(
            "window.__hubSetPermission && window.__hubSetPermission('\(permission)')")
    }

    // The hub asks for notifications or shows one.
    func userContentController(
        _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
    ) async -> (Any?, String?) {
        // Only the hub itself may use this.
        guard message.frameInfo.isMainFrame,
            message.frameInfo.securityOrigin.host == hubAddress.host,
            let body = message.body as? [String: Any],
            let kind = body["kind"] as? String
        else { return (nil, nil) }
        let center = UNUserNotificationCenter.current()
        switch kind {
        case "ask":
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
            let settings = await center.notificationSettings()
            let word = permissionWord(settings.authorizationStatus)
            installBridge(permission: word)
            return (word, nil)
        case "show":
            let content = UNMutableNotificationContent()
            content.title = body["title"] as? String ?? ""
            content.body = body["body"] as? String ?? ""
            content.sound = .default
            let tag = body["tag"] as? String ?? ""
            let request = UNNotificationRequest(
                identifier: tag.isEmpty ? UUID().uuidString : tag, content: content, trigger: nil)
            try? await center.add(request)
            return (true, nil)
        default:
            return (nil, nil)
        }
    }

    // Links to other sites and apps (Meet, Classroom, WhatsApp, email) open outside.
    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        let insideFrame = navigationAction.targetFrame.map { !$0.isMainFrame } ?? false
        if scheme == "http" || scheme == "https" {
            if url.host == hubAddress.host || insideFrame {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            }
        } else if scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
        } else {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    // "Open in new tab" links.
    func webView(
        _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            if url.host == hubAddress.host {
                webView.load(navigationAction.request)
            } else {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        failed.wrappedValue = false
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        let e = error as NSError
        // Not a real failure: a link that opened outside the app.
        if e.code == NSURLErrorCancelled || (e.domain == "WebKitErrorDomain" && e.code == 102) {
            return
        }
        failed.wrappedValue = true
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    // Camera and microphone for the hub only.
    func webView(
        _ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(origin.host == hubAddress.host ? .grant : .prompt)
    }

    // The hub's "Delete this?" questions.
    func webView(
        _ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, otherwise: completionHandler)
    }

    func webView(
        _ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert) { completionHandler(false) }
    }

    private func present(_ alert: UIAlertController, otherwise: () -> Void) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.keyWindow?.rootViewController
        while let shown = top?.presentedViewController {
            top = shown
        }
        if let top {
            top.present(alert, animated: true)
        } else {
            otherwise()
        }
    }
}

// MARK: - Notifications

private func permissionWord(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .authorized, .provisional, .ephemeral: return "granted"
    case .denied: return "denied"
    default: return "default"
    }
}

/// Gives the page the browser's Notification API, backed by iPhone notifications.
private func notificationBridge(permission: String) -> String {
    """
    (() => {
      const hub = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.hub;
      if (!hub) { return; }
      let permission = "\(permission)";
      window.__hubSetPermission = (value) => { permission = value; };
      class HubNotification {
        constructor(title, options) {
          const o = options || {};
          hub.postMessage({ kind: "show", title: String(title || ""), body: String(o.body || ""), tag: String(o.tag || "") });
        }
        static get permission() { return permission; }
        static requestPermission() {
          return hub.postMessage({ kind: "ask" }).then((value) => { permission = value || permission; return permission; });
        }
        close() {}
      }
      window.Notification = HubNotification;
      if (window.ServiceWorkerRegistration) {
        ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
          new HubNotification(title, options);
          return Promise.resolve();
        };
      }
      // The hub only asks for notifications once it is "on the Home Screen".
      try { Object.defineProperty(navigator, "standalone", { get: () => true }); } catch (e) {}
    })();
    """
}

/// Lets notifications show as banners while the app is open.
final class NotificationRelay: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}
