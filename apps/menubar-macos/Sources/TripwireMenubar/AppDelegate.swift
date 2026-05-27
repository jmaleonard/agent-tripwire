import AppKit
import Foundation

class AppDelegate: NSObject, NSApplicationDelegate {
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
        rebuildMenu()
        startPolling()
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
