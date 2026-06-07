import type { DbHandle } from './db.js';

const HEARTBEAT_KEY = 'daemon_heartbeat';

/**
 * Generic key/value access over the `meta` table. Its first use is the daemon
 * liveness heartbeat: the daemon writes `recordHeartbeat()` on a timer, and any
 * reader (CLI `status`/`doctor`, the TUI, the menu-bar app) can tell whether the
 * daemon is alive by reading `getHeartbeat()`, replacing the old HTTP
 * reachability check.
 */
export class MetaRepository {
  private readonly db: DbHandle;

  constructor(db: DbHandle) {
    this.db = db;
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, value);
  }

  /** Record that the daemon is alive as of `now`. Write-only path (daemon). */
  recordHeartbeat(now: Date = new Date()): void {
    this.set(HEARTBEAT_KEY, now.toISOString());
  }

  /** ISO timestamp of the daemon's last heartbeat, or null if it never beat. */
  getHeartbeat(): string | null {
    return this.get(HEARTBEAT_KEY);
  }
}
