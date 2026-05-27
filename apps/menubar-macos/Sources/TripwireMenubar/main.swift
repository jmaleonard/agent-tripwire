import AppKit
import Foundation

// `--notify` mode: short-lived process that fires a single notification via
// UNUserNotificationCenter and exits. The daemon's MacosNotifier invokes us
// this way. Bundle identifier dev.dawnika.tripwire.menubar → notification
// source app is "Tripwire Menubar".
//
//   TripwireMenubar --notify --title "..." [--subtitle "..."] --body "..."
//                            [--url "..."] [--id "..."] [--severity "..."]
if let notifyIdx = CommandLine.arguments.firstIndex(of: "--notify") {
    let args = NotifyArgs.parse(Array(CommandLine.arguments[(notifyIdx + 1)...]))
    exit(runNotifyMode(args))
}

// Menu mode (default): LSUIElement status bar app.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
