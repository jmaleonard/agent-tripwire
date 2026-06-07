import type { Severity } from '@tripwire/shared';
import type { EventRepository } from './events.js';
import type { IoCRepository } from './iocs.js';
import type { MetaRepository } from './meta.js';
import type { SnoozeRepository } from './snooze.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The daemon writes a heartbeat every 30s; treat three missed beats as "down".
 * Generous enough to ride out a slow event-pipeline turn without false alarms.
 */
export const DEFAULT_HEARTBEAT_STALE_MS = 90_000;

export type SummaryCounts = Record<Severity, number>;

export interface SummaryRecentEvent {
  event_id: string;
  timestamp: string;
  severity: Severity;
  rule_id: string;
  rule_name: string | null;
  ancestry_category: string;
}

export interface SummarySnooze {
  active: boolean;
  kind: string | null;
  expires_at: string | null;
}

export interface DaemonLiveness {
  running: boolean;
  last_heartbeat: string | null;
}

/**
 * At-a-glance state of the system, computed directly from the SQLite store.
 * Shared by `tripwire status`, the TUI header, and (re-derived in Swift) the
 * menu-bar app, so all three agree without an HTTP layer between them.
 */
export interface Summary {
  counts: SummaryCounts;
  total: number;
  recent: SummaryRecentEvent[];
  snoozes: SummarySnooze;
  daemon: DaemonLiveness;
  ioc_count: number;
  generated_at: string;
}

export interface SummaryRepos {
  events: EventRepository;
  snoozes: SnoozeRepository;
  iocs?: IoCRepository;
  meta?: MetaRepository;
}

export interface SummaryOptions {
  now?: Date;
  /** How many recent events to include. Default 5 (the menu-bar surface). */
  recentLimit?: number;
  /** Heartbeat age past which the daemon is considered down. */
  heartbeatStaleMs?: number;
}

export function computeSummary(repos: SummaryRepos, opts: SummaryOptions = {}): Summary {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - DAY_MS).toISOString();

  const counts = repos.events.countBySeverity({ since });
  const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;

  const recent: SummaryRecentEvent[] = repos.events
    .list({ since, limit: opts.recentLimit ?? 5 })
    .map(e => ({
      event_id: e.event_id,
      timestamp: e.timestamp,
      severity: e.severity,
      rule_id: e.rule_id,
      rule_name: e.rule_name ?? null,
      ancestry_category: e.identity.category,
    }));

  const reportable = pickReportable(repos.snoozes.listActive(now));
  const snoozes: SummarySnooze = reportable
    ? { active: true, kind: reportable.kind, expires_at: reportable.expires_at }
    : { active: false, kind: null, expires_at: null };

  const lastHeartbeat = repos.meta?.getHeartbeat() ?? null;
  const staleMs = opts.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
  const running =
    lastHeartbeat !== null && now.getTime() - new Date(lastHeartbeat).getTime() <= staleMs;

  return {
    counts,
    total,
    recent,
    snoozes,
    daemon: { running, last_heartbeat: lastHeartbeat },
    ioc_count: repos.iocs?.count() ?? 0,
    generated_at: now.toISOString(),
  };
}

/**
 * Of the active snoozes, the one most worth surfacing: prefer an 'all' snooze
 * (the loudest), then the latest-expiring within that priority.
 */
function pickReportable<T extends { kind: string; expires_at: string }>(
  snoozes: ReadonlyArray<T>,
): T | null {
  if (snoozes.length === 0) return null;
  const all = snoozes.filter(s => s.kind === 'all');
  const pool = all.length > 0 ? all : snoozes;
  let best = pool[0]!;
  for (let i = 1; i < pool.length; i++) {
    if (pool[i]!.expires_at > best.expires_at) best = pool[i]!;
  }
  return best;
}
