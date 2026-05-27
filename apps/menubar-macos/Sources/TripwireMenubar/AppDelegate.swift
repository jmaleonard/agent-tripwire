import AppKit
import Foundation
import UserNotifications

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem!
    private var pollTimer: Timer?
    private let client = DaemonClient(baseURL: URL(string: "http://localhost:7878")!)
    private var currentState: MenuState = .loading

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = symbol(name: "shield", description: "Tripwire")
            button.imagePosition = .imageOnly
        }
        // Own the notification center so clicks on the daemon's --notify
        // banners route here and we can openURL from userInfo.
        UNUserNotificationCenter.current().delegate = self
        // Request notification authorization now while we have a UI context.
        // Bundle-level grant is then shared by --notify subprocess invocations,
        // which can't prompt the user themselves (no LSUI context).
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
            // Ignored — user denial just means no native banners; the
            // dashboard still logs everything.
        }
        rebuildMenu()
        startPolling()
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show banners even when the app is "in foreground" (LSUIElement still
    /// counts as foreground for the notification center).
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(macOS 11.0, *) {
            completionHandler([.banner, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    /// User clicked the banner. If the --notify call stashed an openURL in
    /// userInfo, open it in the browser.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        defer { completionHandler() }
        let userInfo = response.notification.request.content.userInfo
        guard let urlString = userInfo["openURL"] as? String,
              let url = URL(string: urlString)
        else { return }
        NSWorkspace.shared.open(url)
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
    }

    private func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.poll()
        }
        poll()
    }

    private func poll() {
        Task { [weak self] in
            guard let self else { return }
            do {
                let summary = try await self.client.fetchSummary()
                await MainActor.run {
                    self.currentState = .ok(summary)
                    self.rebuildMenu()
                }
            } catch {
                await MainActor.run {
                    // Coalesce all failure modes (refused, timeout, decode) into one state.
                    self.currentState = .daemonDown
                    self.rebuildMenu()
                }
            }
        }
    }

    private func rebuildMenu() {
        statusItem.menu = MenuBuilder.build(state: currentState, target: self)
        updateIcon()
    }

    private func updateIcon() {
        guard let button = statusItem.button else { return }
        switch currentState {
        case .loading:
            button.image = symbol(name: "shield", description: "Tripwire (loading)")
        case .daemonDown:
            button.image = symbol(name: "shield.slash", description: "Tripwire (daemon not running)")
        case .ok(let summary):
            button.image = pickIcon(summary: summary)
        }
    }

    private func pickIcon(summary: Summary) -> NSImage? {
        if summary.snoozes.active {
            return symbol(name: "moon.zzz", description: "Tripwire (snoozed)")
        }
        if summary.counts.critical > 0 {
            return symbol(name: "exclamationmark.triangle.fill",
                          description: "Tripwire (critical events in last 24h)")
        }
        if summary.counts.high > 0 {
            return symbol(name: "shield.fill",
                          description: "Tripwire (high-severity events in last 24h)")
        }
        return symbol(name: "shield", description: "Tripwire")
    }

    private func symbol(name: String, description: String) -> NSImage? {
        return NSImage(systemSymbolName: name, accessibilityDescription: description)
    }

    // MARK: - Menu actions

    @objc func openDashboard(_ sender: Any) {
        if let url = URL(string: "http://localhost:7878") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc func openEvent(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String,
              let url = URL(string: "http://localhost:7878/events/\(id)") else { return }
        NSWorkspace.shared.open(url)
    }

    @objc func clearSnoozes(_ sender: Any) {
        Task { [weak self] in
            guard let self else { return }
            try? await self.client.clearSnoozes()
            self.poll()
        }
    }

    @objc func quit(_ sender: Any) {
        NSApp.terminate(nil)
    }
}
