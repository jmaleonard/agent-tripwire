import type { SnoozeKind } from '@tripwire/shared';
import { Hono } from 'hono';
import type { DashboardDeps } from '../deps.js';

const VALID_KINDS = new Set<SnoozeKind>(['this', 'all']);

export function snoozesRoutes(deps: DashboardDeps): Hono {
  const r = new Hono();

  // GET /api/snoozes?active=true (default true)
  r.get('/', c => {
    const all = c.req.query('active') === 'false';
    const now = (deps.now ?? (() => new Date()))();
    const rows = all ? deps.snoozes.list() : deps.snoozes.listActive(now);
    return c.json({ snoozes: rows });
  });

  r.post('/', async c => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.kind !== 'string' || !VALID_KINDS.has(body.kind as SnoozeKind)) {
      return c.json({ error: 'invalid_kind' }, 400);
    }
    if (typeof body.expires_at !== 'string') {
      return c.json({ error: 'expires_at_required' }, 400);
    }
    if (body.kind === 'this') {
      if (typeof body.rule_id !== 'string' || typeof body.ancestry_hash !== 'string') {
        return c.json({ error: 'this_requires_rule_id_and_ancestry_hash' }, 400);
      }
    }
    const now = (deps.now ?? (() => new Date()))();
    const created = deps.snoozes.add({
      kind: body.kind as SnoozeKind,
      ...(typeof body.rule_id === 'string' ? { rule_id: body.rule_id } : {}),
      ...(typeof body.ancestry_hash === 'string' ? { ancestry_hash: body.ancestry_hash } : {}),
      expires_at: body.expires_at,
      created_at: now.toISOString(),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
    });
    return c.json(created, 201);
  });

  // DELETE /api/snoozes/:id  (single)
  // DELETE /api/snoozes      (clear all)
  r.delete('/:id', c => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
    const removed = deps.snoozes.clear(id);
    return c.json({ removed });
  });

  r.delete('/', c => {
    const removed = deps.snoozes.clear();
    return c.json({ removed });
  });

  return r;
}
