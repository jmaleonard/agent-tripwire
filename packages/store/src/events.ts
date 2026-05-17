import type {
  AncestryCategory,
  Ecosystem,
  EventKind,
  EventSource,
  IoCAttribution,
  PackageRef,
  ProcessIdentity,
  Severity,
  TripwireEvent,
  UserAction,
} from '@tripwire/shared';
import type { DbHandle } from './db.js';

interface EventRow {
  event_id: string;
  timestamp: string;
  source: string;
  severity: string;
  rule_id: string;
  rule_name: string | null;
  path: string | null;
  event_kind: string | null;
  pid: number;
  process_path: string;
  parent_agent_session: string | null;
  ancestry_hash: string;
  ancestry_category: string;
  ancestry_json: string | null;
  package_eco: string | null;
  package_name: string | null;
  package_version: string | null;
  ioc_attribution: string | null;
  snoozed: number;
  notified: number;
  user_action: string;
}

interface AncestryJson {
  argv: string[];
  ancestry_summary?: string[];
}

export interface ListEventsOptions {
  since?: string;
  severity?: Severity;
  ancestryCategory?: AncestryCategory;
  ancestryHash?: string;
  ruleId?: string;
  limit?: number;
  offset?: number;
}

export class EventRepository {
  private readonly db: DbHandle;

  constructor(db: DbHandle) {
    this.db = db;
  }

  insert(event: TripwireEvent): void {
    this.db.prepare(`
      INSERT INTO events (
        event_id, timestamp, source, severity, rule_id, rule_name,
        path, event_kind, pid, process_path, parent_agent_session,
        ancestry_hash, ancestry_category, ancestry_json,
        package_eco, package_name, package_version, ioc_attribution,
        snoozed, notified, user_action
      ) VALUES (
        @event_id, @timestamp, @source, @severity, @rule_id, @rule_name,
        @path, @event_kind, @pid, @process_path, @parent_agent_session,
        @ancestry_hash, @ancestry_category, @ancestry_json,
        @package_eco, @package_name, @package_version, @ioc_attribution,
        @snoozed, @notified, @user_action
      )
    `).run(eventToInsertParams(event));
  }

  getById(id: string): TripwireEvent | null {
    const row = this.db
      .prepare('SELECT * FROM events WHERE event_id = ?')
      .get(id) as EventRow | undefined;
    return row ? rowToEvent(row) : null;
  }

  list(opts: ListEventsOptions = {}): TripwireEvent[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.since !== undefined) {
      where.push('timestamp >= @since');
      params.since = opts.since;
    }
    if (opts.severity !== undefined) {
      where.push('severity = @severity');
      params.severity = opts.severity;
    }
    if (opts.ancestryCategory !== undefined) {
      where.push('ancestry_category = @ancestry_category');
      params.ancestry_category = opts.ancestryCategory;
    }
    if (opts.ancestryHash !== undefined) {
      where.push('ancestry_hash = @ancestry_hash');
      params.ancestry_hash = opts.ancestryHash;
    }
    if (opts.ruleId !== undefined) {
      where.push('rule_id = @rule_id');
      params.rule_id = opts.ruleId;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.limit = opts.limit ?? 100;
    params.offset = opts.offset ?? 0;

    const rows = this.db
      .prepare(`
        SELECT * FROM events ${whereSql}
        ORDER BY timestamp DESC
        LIMIT @limit OFFSET @offset
      `)
      .all(params) as EventRow[];
    return rows.map(rowToEvent);
  }

  setUserAction(id: string, action: UserAction): boolean {
    const result = this.db
      .prepare('UPDATE events SET user_action = ? WHERE event_id = ?')
      .run(action, id);
    return result.changes > 0;
  }

  markSnoozed(id: string): boolean {
    const result = this.db
      .prepare('UPDATE events SET snoozed = 1 WHERE event_id = ?')
      .run(id);
    return result.changes > 0;
  }

  markNotified(id: string): boolean {
    const result = this.db
      .prepare('UPDATE events SET notified = 1 WHERE event_id = ?')
      .run(id);
    return result.changes > 0;
  }
}

function rowToEvent(row: EventRow): TripwireEvent {
  const ancestry: AncestryJson = row.ancestry_json
    ? (JSON.parse(row.ancestry_json) as AncestryJson)
    : { argv: [] };

  const identity: ProcessIdentity = {
    pid: row.pid,
    process_path: row.process_path,
    argv: ancestry.argv,
    parent_agent_session_id: row.parent_agent_session,
    ancestry_summary_hash: row.ancestry_hash,
    category: row.ancestry_category as AncestryCategory,
    ...(ancestry.ancestry_summary !== undefined
      ? { ancestry_summary: ancestry.ancestry_summary }
      : {}),
  };

  let pkg: PackageRef | undefined;
  if (row.package_eco !== null && row.package_name !== null && row.package_version !== null) {
    const attribution = row.ioc_attribution
      ? (JSON.parse(row.ioc_attribution) as IoCAttribution[])
      : undefined;
    pkg = {
      ecosystem: row.package_eco as Ecosystem,
      name: row.package_name,
      version: row.package_version,
      ...(attribution !== undefined ? { ioc_attribution: attribution } : {}),
    };
  }

  return {
    event_id: row.event_id,
    timestamp: row.timestamp,
    source: row.source as EventSource,
    severity: row.severity as Severity,
    rule_id: row.rule_id,
    ...(row.rule_name !== null ? { rule_name: row.rule_name } : {}),
    ...(row.path !== null ? { path: row.path } : {}),
    ...(row.event_kind !== null ? { event_kind: row.event_kind as EventKind } : {}),
    identity,
    ...(pkg !== undefined ? { package: pkg } : {}),
    snoozed: row.snoozed !== 0,
    notified: row.notified !== 0,
    user_action: row.user_action as UserAction,
  };
}

function eventToInsertParams(event: TripwireEvent): Record<string, unknown> {
  const ancestry: AncestryJson = {
    argv: event.identity.argv,
    ...(event.identity.ancestry_summary !== undefined
      ? { ancestry_summary: event.identity.ancestry_summary }
      : {}),
  };

  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    source: event.source,
    severity: event.severity,
    rule_id: event.rule_id,
    rule_name: event.rule_name ?? null,
    path: event.path ?? null,
    event_kind: event.event_kind ?? null,
    pid: event.identity.pid,
    process_path: event.identity.process_path,
    parent_agent_session: event.identity.parent_agent_session_id,
    ancestry_hash: event.identity.ancestry_summary_hash,
    ancestry_category: event.identity.category,
    ancestry_json: JSON.stringify(ancestry),
    package_eco: event.package?.ecosystem ?? null,
    package_name: event.package?.name ?? null,
    package_version: event.package?.version ?? null,
    ioc_attribution: event.package?.ioc_attribution
      ? JSON.stringify(event.package.ioc_attribution)
      : null,
    snoozed: event.snoozed ? 1 : 0,
    notified: event.notified ? 1 : 0,
    user_action: event.user_action ?? 'pending',
  };
}
