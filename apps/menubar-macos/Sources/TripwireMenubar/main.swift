import AppKit

let app = NSApplication.shared
// .accessory keeps the app off the Dock and out of the Cmd-Tab switcher.
// LSUIElement in Info.plist achieves the same for bundled .app installs;
// setting it programmatically too lets `swift run` work for dev.
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
