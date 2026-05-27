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

  return r;
}
