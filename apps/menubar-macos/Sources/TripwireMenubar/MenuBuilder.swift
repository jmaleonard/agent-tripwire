import AppKit

enum MenuState {
    case loading
    case noStore
    case ok(Summary)
}

enum MenuBuilder {
    static func build(state: MenuState, target: AppDelegate) -> NSMenu {
        let menu = NSMenu()
        switch state {
        case .loading:
            menu.addItem(disabled("Connecting…"))
        case .noStore:
            menu.addItem(disabled("Not set up yet"))
            menu.addItem(disabled("Run  tripwire setup"))
        case .ok(let summary):
            buildOkSection(menu, summary: summary, target: target)
        }
        menu.addItem(.separator())
        appendAction(menu, title: "Open Tripwire TUI…",
                     selector: #selector(AppDelegate.openTui(_:)),
                     target: target)
        menu.addItem(.separator())
        appendAction(menu, title: "Quit Tripwire Menubar",
                     selector: #selector(AppDelegate.quit(_:)),
                     target: target, key: "q")
        return menu
    }

    private static func buildOkSection(_ menu: NSMenu, summary: Summary, target: AppDelegate) {
        if !summary.daemonRunning {
            menu.addItem(disabled("⚠ daemon not running"))
            menu.addItem(disabled("Start: brew services start tripwire"))
            menu.addItem(.separator())
        }

        let c = summary.counts
        menu.addItem(disabled("Last 24h: \(c.critical) crit · \(c.high) high · \(c.medium) med · \(c.low) low"))

        if summary.snooze.active {
            menu.addItem(.separator())
            menu.addItem(disabled("⌚ Snoozed: \(formatSnoozeLabel(summary.snooze))"))
            appendAction(menu, title: "Clear all snoozes",
                         selector: #selector(AppDelegate.clearSnoozes(_:)),
                         target: target)
        }

        if !summary.recent.isEmpty {
            menu.addItem(.separator())
            menu.addItem(disabled("Recent"))
            for event in summary.recent.prefix(5) {
                menu.addItem(disabled("\(event.severity.uppercased())  \(event.ruleName ?? event.ruleId)"))
            }
        }
    }

    private static func formatSnoozeLabel(_ s: Summary.SnoozeState) -> String {
        guard let exp = s.expiresAt else { return s.kind ?? "active" }
        let remaining = exp.timeIntervalSinceNow
        if remaining <= 0 { return "expired" }
        let minutes = Int(remaining / 60)
        if minutes < 1 { return "<1m" }
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let mins = minutes % 60
        return mins > 0 ? "\(hours)h \(mins)m" : "\(hours)h"
    }

    private static func disabled(_ title: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        item.isEnabled = false
        return item
    }

    private static func appendAction(_ menu: NSMenu, title: String,
                                     selector: Selector, target: AnyObject,
                                     key: String = "") {
        let item = NSMenuItem(title: title, action: selector, keyEquivalent: key)
        item.target = target
        menu.addItem(item)
    }
}
