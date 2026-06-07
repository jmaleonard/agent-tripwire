// Initial schema. Source of truth for the events.db structure (spec §6.11).
// Embedded as a string so the build is just `tsc` — no asset-copying.
export const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
    event_id              TEXT PRIMARY KEY,
    timestamp             TEXT NOT NULL,
    source                TEXT NOT NULL,
    severity              TEXT NOT NULL,
    rule_id               TEXT NOT NULL,
    rule_name             TEXT,
    path                  TEXT,
    event_kind            TEXT,
    pid                   INTEGER NOT NULL,
    process_path          TEXT NOT NULL,
    parent_agent_session  TEXT,
    ancestry_hash         TEXT NOT NULL,
    ancestry_category     TEXT NOT NULL,
    ancestry_json         TEXT,
    package_eco           TEXT,
    package_name          TEXT,
    package_version       TEXT,
    ioc_attribution       TEXT,
    snoozed               INTEGER NOT NULL DEFAULT 0,
    notified              INTEGER NOT NULL DEFAULT 0,
    user_action           TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_severity  ON events(severity);
CREATE INDEX IF NOT EXISTS idx_events_ancestry  ON events(ancestry_hash);

CREATE TABLE IF NOT EXISTS allowlist (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scope           TEXT NOT NULL,
    rule_id         TEXT,
    ancestry_hash   TEXT,
    process_path    TEXT,
    path_pattern    TEXT,
    reason          TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snoozes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT NOT NULL,
    rule_id         TEXT,
    ancestry_hash   TEXT,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    reason          TEXT
);

CREATE INDEX IF NOT EXISTS idx_snoozes_expires ON snoozes(expires_at);

CREATE TABLE IF NOT EXISTS iocs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ecosystem       TEXT NOT NULL,
    package         TEXT NOT NULL,
    version_spec    TEXT NOT NULL,
    sources         TEXT NOT NULL,
    campaign        TEXT,
    first_seen      TEXT NOT NULL,
    last_seen       TEXT NOT NULL,
    UNIQUE(ecosystem, package, version_spec)
);

CREATE INDEX IF NOT EXISTS idx_iocs_lookup ON iocs(ecosystem, package);
`;

// Migration 002: tracks where the local IoC DB sits relative to the published
// feed, so the sync service can fetch only the deltas it's missing. Single-row
// table (id is pinned to 1).
export const FEED_STATE_SCHEMA = `
CREATE TABLE IF NOT EXISTS feed_state (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    synced_date  TEXT,
    etag         TEXT,
    last_sync_at TEXT
);
`;

// Migration 003: generic key/value store. Currently holds the daemon liveness
// heartbeat (key 'daemon_heartbeat') so the CLI, TUI, and menu-bar app can tell
// whether the daemon is running by reading the DB.
export const META_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
`;
