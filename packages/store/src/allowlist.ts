import type { AllowlistEntry, AllowlistScope } from '@tripwire/shared';
import type { DbHandle } from './db.js';

interface AllowlistRow {
  id: number;
  scope: string;
  rule_id: string | null;
  ancestry_hash: string | null;
  process_path: string | null;
  path_pattern: string | null;
  reason: string | null;
  created_at: string;
}

export interface AllowlistMatchInput {
  ruleId: string;
  ancestryHash: string;
  processPath: string;
  path: string;
}

export class AllowlistRepository {
  private readonly db: DbHandle;

  constructor(db: DbHandle) {
    this.db = db;
  }

  add(entry: Omit<AllowlistEntry, 'id'>): AllowlistEntry {
    const result = this.db
      .prepare(`
        INSERT INTO allowlist (
          scope, rule_id, ancestry_hash, process_path, path_pattern, reason, created_at
        ) VALUES (
          @scope, @rule_id, @ancestry_hash, @process_path, @path_pattern, @reason, @created_at
        )
      `)
      .run({
        scope: entry.scope,
        rule_id: entry.rule_id ?? null,
        ancestry_hash: entry.ancestry_hash ?? null,
        process_path: entry.process_path ?? null,
        path_pattern: entry.path_pattern ?? null,
        reason: entry.reason ?? null,
        created_at: entry.created_at,
      });
    return { ...entry, id: Number(result.lastInsertRowid) };
  }

  list(): AllowlistEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM allowlist ORDER BY created_at DESC')
      .all() as AllowlistRow[];
    return rows.map(rowToEntry);
  }

  remove(id: number): boolean {
    return this.db.prepare('DELETE FROM allowlist WHERE id = ?').run(id).changes > 0;
  }

  matches(input: AllowlistMatchInput): AllowlistEntry | null {
    const rows = this.db
      .prepare('SELECT * FROM allowlist WHERE rule_id = ?')
      .all(input.ruleId) as AllowlistRow[];
    for (const row of rows) {
      const entry = rowToEntry(row);
      if (entryMatches(entry, input)) return entry;
    }
    return null;
  }
}

function rowToEntry(row: AllowlistRow): AllowlistEntry {
  return {
    id: row.id,
    scope: row.scope as AllowlistScope,
    ...(row.rule_id !== null ? { rule_id: row.rule_id } : {}),
    ...(row.ancestry_hash !== null ? { ancestry_hash: row.ancestry_hash } : {}),
    ...(row.process_path !== null ? { process_path: row.process_path } : {}),
    ...(row.path_pattern !== null ? { path_pattern: row.path_pattern } : {}),
    ...(row.reason !== null ? { reason: row.reason } : {}),
    created_at: row.created_at,
  };
}

function entryMatches(entry: AllowlistEntry, input: AllowlistMatchInput): boolean {
  if (entry.rule_id !== input.ruleId) return false;
  switch (entry.scope) {
    case 'rule':
      return true;
    case 'rule+ancestry':
      return entry.ancestry_hash === input.ancestryHash;
    case 'rule+process':
      return entry.process_path === input.processPath;
    default:
      return false;
  }
}
