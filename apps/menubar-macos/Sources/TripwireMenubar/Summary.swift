import Foundation

/// At-a-glance state, read straight from the SQLite store by `StoreReader`.
/// (Previously decoded from the daemon's `GET /api/summary`; there is no server
/// anymore.)
struct Summary {
    let counts: SeverityCounts
    let recent: [RecentEvent]
    let snooze: SnoozeState
    let daemonRunning: Bool

    struct SeverityCounts {
        let critical: Int
        let high: Int
        let medium: Int
        let low: Int
        let info: Int
    }

    struct RecentEvent {
        let severity: String
        let ruleId: String
        let ruleName: String?
        let ancestryCategory: String
    }

    struct SnoozeState {
        let active: Bool
        let kind: String?
        let expiresAt: Date?
    }
}
