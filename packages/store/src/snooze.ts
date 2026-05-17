import type { Snooze, SnoozeKind } from '@tripwire/shared';
import type { DbHandle } from './db.js';

interface SnoozeRow {
  id: number;
  kind: string;
  rule_id: string | null;
  ancestry_hash: string | null;
  expires_at: string;
  created_at: string;
  reason: string | null;
}

export interface IsSnoozedInput {
  ruleId: string;
  ancestryHash: string;
  now?: Date;
}

export class SnoozeRepository {
  private readonly db: DbHandle;

  constructor(db: DbHandle) {
    this.db = db;
  }

  add(snooze: Omit<Snooze, 'id'>): Snooze {
    const result = this.db
      .prepare(`
        INSERT INTO snoozes (kind, rule_id, ancestry_hash, expires_at, created_at, reason)
        VALUES (@kind, @rule_id, @ancestry_hash, @expires_at, @created_at, @reason)
      `)
      .run({
        kind: snooze.kind,
        rule_id: snooze.rule_id ?? null,
        ancestry_hash: snooze.ancestry_hash ?? null,
        expires_at: snooze.expires_at,
        created_at: snooze.created_at,
        reason: snooze.reason ?? null,
      });
    return { ...snooze, id: Number(result.lastInsertRowid) };
  }

  list(): Snooze[] {
    const rows = this.db
      .prepare('SELECT * FROM snoozes ORDER BY expires_at ASC')
      .all() as SnoozeRow[];
    return rows.map(rowToSnooze);
  }

  listActive(now: Date = new Date()): Snooze[] {
    const rows = this.db
      .prepare('SELECT * FROM snoozes WHERE expires_at > ? ORDER BY expires_at ASC')
      .all(now.toISOString()) as SnoozeRow[];
    return rows.map(rowToSnooze);
  }

  clear(id?: number): number {
    if (id === undefined) {
      return this.db.prepare('DELETE FROM snoozes').run().changes;
    }
    return this.db.prepare('DELETE FROM snoozes WHERE id = ?').run(id).changes;
  }

  purgeExpired(now: Date = new Date()): number {
    return this.db
      .prepare('DELETE FROM snoozes WHERE expires_at <= ?')
      .run(now.toISOString()).changes;
  }

  isSnoozed(input: IsSnoozedInput): boolean {
    const nowIso = (input.now ?? new Date()).toISOString();
    const allActive = this.db
      .prepare(`
        SELECT 1 FROM snoozes
        WHERE kind = 'all' AND expires_at > ?
        LIMIT 1
      `)
      .get(nowIso);
    if (allActive) return true;

    const specific = this.db
      .prepare(`
        SELECT 1 FROM snoozes
        WHERE kind = 'this'
          AND rule_id = ?
          AND ancestry_hash = ?
          AND expires_at > ?
        LIMIT 1
      `)
      .get(input.ruleId, input.ancestryHash, nowIso);
    return Boolean(specific);
  }
}

function rowToSnooze(row: SnoozeRow): Snooze {
  return {
    id: row.id,
    kind: row.kind as SnoozeKind,
    ...(row.rule_id !== null ? { rule_id: row.rule_id } : {}),
    ...(row.ancestry_hash !== null ? { ancestry_hash: row.ancestry_hash } : {}),
    expires_at: row.expires_at,
    created_at: row.created_at,
    ...(row.reason !== null ? { reason: row.reason } : {}),
  };
}
