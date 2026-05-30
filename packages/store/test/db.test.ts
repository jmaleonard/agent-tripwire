import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db.js';

describe('openDb', () => {
  it('applies the initial migration in :memory:', () => {
    const db = openDb({ path: ':memory:' });
    const names = (db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>).map(r => r.name);
    expect(names).toEqual(
      expect.arrayContaining(['events', 'snoozes', 'allowlist', 'iocs', '_migrations']),
    );
    db.close();
  });

  it('records migrations in _migrations', () => {
    const db = openDb({ path: ':memory:' });
    const rows = db.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
    expect(rows.map(r => r.name)).toEqual(['001_initial', '002_feed_state']);
    db.close();
  });

  it('enables WAL journaling on writable opens', () => {
    const db = openDb({ path: ':memory:' });
    const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0]?.journal_mode;
    // SQLite reports 'memory' for :memory: dbs; WAL applies on file-backed dbs.
    expect(['wal', 'memory']).toContain(mode);
    db.close();
  });

  describe('with a file-backed DB', () => {
    let dir: string;
    let dbPath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'tripwire-store-test-'));
      dbPath = join(dir, 'test.db');
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it('is idempotent across reopens', () => {
      openDb({ path: dbPath }).close();
      const db2 = openDb({ path: dbPath });
      const rows = db2.prepare('SELECT name FROM _migrations').all() as Array<{ name: string }>;
      expect(rows.map(r => r.name)).toEqual(['001_initial', '002_feed_state']);
      db2.close();
    });

    it('uses WAL journaling on file-backed DBs', () => {
      const db = openDb({ path: dbPath });
      const mode = (db.pragma('journal_mode') as Array<{ journal_mode: string }>)[0]?.journal_mode;
      expect(mode).toBe('wal');
      db.close();
    });
  });
});
