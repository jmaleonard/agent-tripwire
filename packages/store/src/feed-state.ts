import type { DbHandle } from './db.js';

export interface FeedState {
  /** ISO date (YYYY-MM-DD) the local IoC table is current as of, or null if never synced. */
  syncedDate: string | null;
  /** Last ETag seen for the manifest, for conditional GETs. */
  etag: string | null;
  /** ISO timestamp of the last successful sync attempt. */
  lastSyncAt: string | null;
}

const EMPTY: FeedState = { syncedDate: null, etag: null, lastSyncAt: null };

/** Single-row accessor for `feed_state` (the IoC feed sync bookmark). */
export class FeedStateRepository {
  private readonly db: DbHandle;

  constructor(db: DbHandle) {
    this.db = db;
  }

  get(): FeedState {
    const row = this.db
      .prepare('SELECT synced_date, etag, last_sync_at FROM feed_state WHERE id = 1')
      .get() as { synced_date: string | null; etag: string | null; last_sync_at: string | null } | undefined;
    if (!row) return { ...EMPTY };
    return {
      syncedDate: row.synced_date,
      etag: row.etag,
      lastSyncAt: row.last_sync_at,
    };
  }

  set(state: FeedState): void {
    this.db
      .prepare(`
        INSERT INTO feed_state (id, synced_date, etag, last_sync_at)
        VALUES (1, @syncedDate, @etag, @lastSyncAt)
        ON CONFLICT(id) DO UPDATE SET
          synced_date = excluded.synced_date,
          etag = excluded.etag,
          last_sync_at = excluded.last_sync_at
      `)
      .run({
        syncedDate: state.syncedDate,
        etag: state.etag,
        lastSyncAt: state.lastSyncAt,
      });
  }
}
