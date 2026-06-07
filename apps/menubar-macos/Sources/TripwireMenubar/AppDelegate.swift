import AppKit
import Foundation
import UserNotifications

class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    private var statusItem: NSStatusItem!
    private var pollTimer: Timer?
    private var currentState: MenuState = .loading

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = statusItem.button {
            button.image = symbol(name: "shield", description: "Tripwire")
            button.imagePosition = .imageOnly
        }
        // Own the notification center so the daemon's --notify banners present
        // even while we're the foreground (LSUIElement) app.
        UNUserNotificationCenter.current().delegate = self
        // Request authorization now, while we have a UI context. The grant is
        // shared by --notify subprocess invocations, which can't prompt.
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in
            // Denial just means no native banners; the store still records everything.
        }
        rebuildMenu()
        startPolling()
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Show banners even when we're "in foreground" (LSUIElement counts as
    /// foreground for the notification center).
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

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
    }

    private func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.poll()
        }
        poll()
    }

    /// Read the SQLite store off the main thread, then update the UI.
    private func poll() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let state = StoreReader.read()
            DispatchQueue.main.async {
                self?.currentState = state
                self?.rebuildMenu()
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
        case .noStore:
            button.image = symbol(name: "shield.slash", description: "Tripwire (not set up)")
        case .ok(let summary):
            button.image = pickIcon(summary: summary)
        }
    }

    private func pickIcon(summary: Summary) -> NSImage? {
        if !summary.daemonRunning {
            return symbol(name: "shield.slash", description: "Tripwire (daemon not running)")
        }
        if summary.snooze.active {
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

    /// Open the user's Terminal and launch the TUI (the inspection surface that
    /// replaced the web dashboard). Best-effort: targets Terminal.app.
    @objc func openTui(_ sender: Any) {
        let script = """
        tell application "Terminal"
            activate
            do script "tripwire tui"
        end tell
        """
        runProcess("/usr/bin/osascript", ["-e", script])
    }

    @objc func clearSnoozes(_ sender: Any) {
        // Route writes through the CLI so the store has a single writer path.
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            self?.runTripwire(["snooze", "clear"])?.waitUntilExit()
            DispatchQueue.main.async { self?.poll() }
        }
    }

    @objc func quit(_ sender: Any) {
        NSApp.terminate(nil)
    }

    // MARK: - Subprocess helpers

    @discardableResult
    private func runTripwire(_ args: [String]) -> Process? {
        // GUI apps don't inherit the login-shell PATH, so resolve the brew paths.
        let candidates = ["/opt/homebrew/bin/tripwire", "/usr/local/bin/tripwire"]
        let bin = candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
        if let bin {
            return runProcess(bin, args)
        }
        return runProcess("/usr/bin/env", ["tripwire"] + args)
    }

    @discardableResult
    private func runProcess(_ launchPath: String, _ args: [String]) -> Process? {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: launchPath)
        task.arguments = args
        do {
            try task.run()
            return task
        } catch {
            return nil
        }
    }
}
