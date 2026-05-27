import Foundation

/// Payload returned by the daemon's `GET /api/summary` endpoint.
/// The dashboard server hasn't shipped yet; this is the contract it'll honor.
struct Summary: Codable {
    let counts: SeverityCounts
    let recent: [RecentEvent]
    let snoozes: SnoozeState

    struct SeverityCounts: Codable {
        let critical: Int
        let high: Int
        let medium: Int
        let low: Int
        let info: Int
    }

    struct RecentEvent: Codable {
        let event_id: String
        let timestamp: Date
        let severity: String
        let rule_id: String
        let rule_name: String?
        let ancestry_category: String
    }

    struct SnoozeState: Codable {
        let active: Bool
        let kind: String?
        let expires_at: Date?
    }
}
