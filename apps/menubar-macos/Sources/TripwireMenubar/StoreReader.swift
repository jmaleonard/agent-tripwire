import Foundation
import SQLite3

// SQLite wants this sentinel so it copies bound strings; the Swift overlay
// doesn't expose it.
private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

/// Reads the daemon's SQLite store directly. Replaces the old HTTP client: the
/// daemon no longer serves anything, it just writes the same DB the CLI and TUI
/// read. Daemon liveness comes from the heartbeat row in `meta`.
///
/// We open read-WRITE (the user owns the file) but only ever run SELECTs. A
/// read-only handle can't attach the WAL shared-memory index when no writer is
/// holding the DB open, so it would miss events still in the `-wal` while the
/// daemon is stopped — exactly when you'd want to see them.
enum StoreReader {
    /// Heartbeat older than this ⇒ daemon considered down (store default is 90s).
    static let heartbeatStale: TimeInterval = 90

    static var defaultDbPath: String {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".tripwire/events.db")
            .path
    }

    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    /// Read the current state, or `.noStore` if the DB isn't there yet.
    static func read(dbPath: String = defaultDbPath, now: Date = Date()) -> MenuState {
        guard FileManager.default.fileExists(atPath: dbPath) else { return .noStore }
        var db: OpaquePointer?
        guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READWRITE, nil) == SQLITE_OK, let db else {
            if let db { sqlite3_close(db) }
            return .noStore
        }
        defer { sqlite3_close(db) }
        sqlite3_busy_timeout(db, 2000)

        let sinceISO = iso.string(from: now.addingTimeInterval(-86_400))
        let nowISO = iso.string(from: now)

        let counts = readCounts(db, since: sinceISO)
        let recent = readRecent(db, since: sinceISO)
        let snooze = readSnooze(db, now: nowISO)
        let running = readHeartbeat(db).map { now.timeIntervalSince($0) <= heartbeatStale } ?? false

        return .ok(
            Summary(counts: counts, recent: recent, snooze: snooze, daemonRunning: running)
        )
    }

    // MARK: - Queries

    private static func readCounts(_ db: OpaquePointer, since: String) -> Summary.SeverityCounts {
        var c = [String: Int]()
        query(db, "SELECT severity, COUNT(*) FROM events WHERE timestamp >= ? GROUP BY severity",
              binds: [since]) { stmt in
            let sev = column(stmt, 0)
            c[sev] = Int(sqlite3_column_int(stmt, 1))
        }
        return Summary.SeverityCounts(
            critical: c["critical"] ?? 0,
            high: c["high"] ?? 0,
            medium: c["medium"] ?? 0,
            low: c["low"] ?? 0,
            info: c["info"] ?? 0
        )
    }

    private static func readRecent(_ db: OpaquePointer, since: String) -> [Summary.RecentEvent] {
        var out = [Summary.RecentEvent]()
        query(db, """
            SELECT severity, rule_id, rule_name, ancestry_category
            FROM events WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 5
            """, binds: [since]) { stmt in
            out.append(Summary.RecentEvent(
                severity: column(stmt, 0),
                ruleId: column(stmt, 1),
                ruleName: columnOpt(stmt, 2),
                ancestryCategory: column(stmt, 3)
            ))
        }
        return out
    }

    private static func readSnooze(_ db: OpaquePointer, now: String) -> Summary.SnoozeState {
        var state = Summary.SnoozeState(active: false, kind: nil, expiresAt: nil)
        // Prefer an 'all' snooze, then the latest-expiring (matches computeSummary).
        query(db, """
            SELECT kind, expires_at FROM snoozes WHERE expires_at > ?
            ORDER BY CASE kind WHEN 'all' THEN 0 ELSE 1 END, expires_at DESC LIMIT 1
            """, binds: [now]) { stmt in
            state = Summary.SnoozeState(
                active: true,
                kind: column(stmt, 0),
                expiresAt: iso.date(from: column(stmt, 1))
            )
        }
        return state
    }

    private static func readHeartbeat(_ db: OpaquePointer) -> Date? {
        var beat: Date?
        // meta may not exist on a pre-migration-003 DB; query() tolerates that.
        query(db, "SELECT value FROM meta WHERE key = 'daemon_heartbeat'", binds: []) { stmt in
            beat = iso.date(from: column(stmt, 0))
        }
        return beat
    }

    // MARK: - Tiny query helper

    private static func query(
        _ db: OpaquePointer,
        _ sql: String,
        binds: [String],
        row: (OpaquePointer) -> Void
    ) {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else { return }
        defer { sqlite3_finalize(stmt) }
        for (i, value) in binds.enumerated() {
            sqlite3_bind_text(stmt, Int32(i + 1), value, -1, SQLITE_TRANSIENT)
        }
        while sqlite3_step(stmt) == SQLITE_ROW {
            row(stmt)
        }
    }

    private static func column(_ stmt: OpaquePointer, _ idx: Int32) -> String {
        guard let c = sqlite3_column_text(stmt, idx) else { return "" }
        return String(cString: c)
    }

    private static func columnOpt(_ stmt: OpaquePointer, _ idx: Int32) -> String? {
        guard let c = sqlite3_column_text(stmt, idx) else { return nil }
        return String(cString: c)
    }
}
