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
