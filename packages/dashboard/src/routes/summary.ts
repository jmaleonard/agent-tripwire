import { Hono } from 'hono';
import type { DashboardDeps } from '../deps.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Matches the Swift menubar app's `Summary` shape exactly. If you change this,
 * change apps/menubar-macos/Sources/TripwireMenubar/Summary.swift too.
 */
export function summaryRoutes(deps: DashboardDeps): Hono {
  const r = new Hono();

  r.get('/', c => {
    const now = (deps.now ?? (() => new Date()))();
    const since = new Date(now.getTime() - DAY_MS).toISOString();

    const counts = deps.events.countBySeverity({ since });
    const recent = deps.events
      .list({ since, limit: 5 })
      .map(e => ({
        event_id: e.event_id,
        timestamp: e.timestamp,
        severity: e.severity,
        rule_id: e.rule_id,
        rule_name: e.rule_name ?? null,
        ancestry_category: e.identity.category,
      }));

    const active = deps.snoozes.listActive(now);
    // Prefer reporting 'all' snoozes over 'this' snoozes (the more impactful
    // surface to surface). Pick the latest-expiring within that priority.
    const reportable = pickReportable(active);

    return c.json({
      counts,
      recent,
      snoozes: reportable
        ? {
            active: true,
            kind: reportable.kind,
            expires_at: reportable.expires_at,
          }
        : { active: false, kind: null, expires_at: null },
    });
  });

  return r;
}

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
