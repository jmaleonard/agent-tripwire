import Database from 'better-sqlite3';
import type { Database as BetterSqlite3Database } from 'better-sqlite3';
import { FEED_STATE_SCHEMA, INITIAL_SCHEMA, META_SCHEMA } from './schema.js';

export interface OpenDbOptions {
  path: string;
  readonly?: boolean;
}

export type DbHandle = BetterSqlite3Database;

const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
  { name: '001_initial', sql: INITIAL_SCHEMA },
  { name: '002_feed_state', sql: FEED_STATE_SCHEMA },
  { name: '003_meta', sql: META_SCHEMA },
];

export function openDb(opts: OpenDbOptions): DbHandle {
  const readonly = opts.readonly ?? false;
  const db = new Database(opts.path, { readonly });

  db.pragma('foreign_keys = ON');
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
    applyMigrations(db);
  }

  return db;
}

export function closeDb(db: DbHandle): void {
  db.close();
}

function applyMigrations(db: DbHandle): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT UNIQUE NOT NULL,
      applied_at  TEXT NOT NULL
    )
  `);

  const isApplied = db.prepare('SELECT 1 FROM _migrations WHERE name = ?');
  const record = db.prepare(
    'INSERT INTO _migrations (name, applied_at) VALUES (?, ?)',
  );

  const applyOne = db.transaction((m: { name: string; sql: string }) => {
    db.exec(m.sql);
    record.run(m.name, new Date().toISOString());
  });

  for (const m of MIGRATIONS) {
    if (!isApplied.get(m.name)) {
      applyOne(m);
    }
  }
}
