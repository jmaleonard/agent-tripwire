import type { Ecosystem } from '@tripwire/shared';
import { Hono } from 'hono';
import type { DashboardDeps } from '../deps.js';

const VALID_ECOSYSTEMS = new Set<Ecosystem>(['npm', 'pypi', 'other']);

export function iocsRoutes(deps: DashboardDeps): Hono {
  const r = new Hono();

  r.get('/', c => {
    const ecosystem = c.req.query('ecosystem');
    const pkg = c.req.query('package');
    if (ecosystem && pkg) {
      if (!VALID_ECOSYSTEMS.has(ecosystem as Ecosystem)) {
        return c.json({ error: 'invalid_ecosystem' }, 400);
      }
      return c.json({ entries: deps.iocs.lookup(ecosystem as Ecosystem, pkg) });
    }
    return c.json({ count: deps.iocs.count() });
  });

  // Feed sync status (where the local DB sits relative to the published feed).
  r.get('/sync', c => {
    const state = deps.feedState?.get() ?? { syncedDate: null, etag: null, lastSyncAt: null };
    return c.json({
      enabled: deps.onSyncIocs !== undefined,
      count: deps.iocs.count(),
      synced_date: state.syncedDate,
      last_sync_at: state.lastSyncAt,
    });
  });

  // Trigger a feed pull into the local store.
  r.post('/sync', async c => {
    if (!deps.onSyncIocs) {
      return c.json({ error: 'sync_disabled' }, 503);
    }
    try {
      const result = await deps.onSyncIocs();
      return c.json(result as Record<string, unknown>);
    } catch (err) {
      return c.json({ error: 'sync_failed', message: (err as Error).message }, 502);
    }
  });

  return r;
}
