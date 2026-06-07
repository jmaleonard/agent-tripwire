import Foundation
import UserNotifications

struct NotifyArgs {
    let title: String
    let subtitle: String?
    let body: String
    let id: String?
    let severity: String?

    static func parse(_ argv: [String]) -> NotifyArgs {
        var title = ""
        var subtitle: String? = nil
        var body = ""
        var id: String? = nil
        var severity: String? = nil

        var i = 0
        while i < argv.count {
            let flag = argv[i]
            let next: String? = (i + 1 < argv.count) ? argv[i + 1] : nil
            switch flag {
            case "--title":    if let v = next { title = v };    i += 2
            case "--subtitle": if let v = next { subtitle = v }; i += 2
            case "--body":     if let v = next { body = v };     i += 2
            case "--id":       if let v = next { id = v };       i += 2
            case "--severity": if let v = next { severity = v }; i += 2
            default: i += 1
            }
        }
        return NotifyArgs(title: title, subtitle: subtitle, body: body, id: id, severity: severity)
    }
}

/// Fire a single notification via UNUserNotificationCenter and exit. Uses the
/// .app bundle identifier (io.github.jmaleonard.tripwire.menubar) so banners appear
/// with "Tripwire Menubar" as the source app.
///
/// Authorization MUST already be granted — we don't call requestAuthorization
/// here because a CLI invocation has no UI context and the prompt would hang.
/// The menubar app's applicationDidFinishLaunching requests it on first launch,
/// which is shared by all processes that share the bundle identifier.
///
/// Exit codes:
///   0 = notification dispatched
///   1 = add() failed (system error)
///   2 = timed out
///   3 = notifications not authorized (user denied, or never launched the app)
func runNotifyMode(_ args: NotifyArgs) -> Int32 {
    let center = UNUserNotificationCenter.current()
    let group = DispatchGroup()
    var addError: Error? = nil
    var authStatus: UNAuthorizationStatus = .notDetermined

    group.enter()
    center.getNotificationSettings { settings in
        authStatus = settings.authorizationStatus
        guard settings.authorizationStatus == .authorized ||
              settings.authorizationStatus == .provisional
        else {
            group.leave()
            return
        }

        let content = UNMutableNotificationContent()
        content.title = args.title
        if let subtitle = args.subtitle, !subtitle.isEmpty {
            content.subtitle = subtitle
        }
        content.body = args.body
        if let severity = args.severity { content.userInfo = ["severity": severity] }
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: args.id ?? UUID().uuidString,
            content: content,
            trigger: nil
        )
        center.add(request) { error in
            addError = error
            group.leave()
        }
    }

    let timedOut = group.wait(timeout: .now() + 5) == .timedOut
    if timedOut {
        FileHandle.standardError.write("notify: timed out\n".data(using: .utf8)!)
        return 2
    }
    if authStatus != .authorized && authStatus != .provisional {
        FileHandle.standardError.write(
            "notify: not authorized (status=\(authStatus.rawValue)). Open Tripwire Menubar.app once and click Allow when prompted.\n"
                .data(using: .utf8)!,
        )
        return 3
    }
    if let err = addError {
        FileHandle.standardError.write("notify: \(err.localizedDescription)\n".data(using: .utf8)!)
        return 1
    }
    return 0
}
