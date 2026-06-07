import AppKit
import Foundation

// `--notify` mode: short-lived process that fires a single notification via
// UNUserNotificationCenter and exits. The daemon's MacosNotifier invokes us
// this way. Bundle identifier io.github.jmaleonard.tripwire.menubar → notification
// source app is "Tripwire Menubar".
//
//   TripwireMenubar --notify --title "..." [--subtitle "..."] --body "..."
//                            [--id "..."] [--severity "..."]
if let notifyIdx = CommandLine.arguments.firstIndex(of: "--notify") {
    let args = NotifyArgs.parse(Array(CommandLine.arguments[(notifyIdx + 1)...]))
    exit(runNotifyMode(args))
}

// `--summary` mode: read the SQLite store and print a one-line status, then
// exit. No GUI — handy for verifying the store reader headlessly. `--db <path>`
// overrides the default ~/.tripwire/events.db (used in tests).
if CommandLine.arguments.contains("--summary") {
    let args = CommandLine.arguments
    let dbPath: String
    if let i = args.firstIndex(of: "--db"), i + 1 < args.count {
        dbPath = args[i + 1]
    } else {
        dbPath = StoreReader.defaultDbPath
    }
    switch StoreReader.read(dbPath: dbPath) {
    case .noStore: print("no store")
    case .loading: print("loading")
    case .ok(let s):
        let c = s.counts
        print(
            "daemon=\(s.daemonRunning ? "up" : "down") "
                + "24h=\(c.critical)c/\(c.high)h/\(c.medium)m/\(c.low)l "
                + "snooze=\(s.snooze.active ? (s.snooze.kind ?? "yes") : "no") "
                + "recent=\(s.recent.count)"
        )
    }
    exit(0)
}

// Menu mode (default): LSUIElement status bar app.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
