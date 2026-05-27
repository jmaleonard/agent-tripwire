import { type AncestryCategory, type Severity, type UserAction } from '@tripwire/shared';
import { Hono } from 'hono';
import type { DashboardDeps } from '../deps.js';

const VALID_SEVERITIES = new Set<Severity>(['critical', 'high', 'medium', 'low', 'info']);
const VALID_CATEGORIES = new Set<AncestryCategory>([
  'human-shell',
  'agent-direct',
  'agent-subprocess',
  'package-manager-direct',
  'package-manager-spawned',
  'unknown',
]);
const VALID_ACTIONS = new Set<UserAction>(['pending', 'allowlisted', 'dismissed', 'investigated']);

export function eventsRoutes(deps: DashboardDeps): Hono {
  const r = new Hono();

  r.get('/', c => {
    const q = c.req.query();
    const severity = q.severity && VALID_SEVERITIES.has(q.severity as Severity)
      ? (q.severity as Severity)
      : undefined;
    const ancestryCategory = q.category && VALID_CATEGORIES.has(q.category as AncestryCategory)
      ? (q.category as AncestryCategory)
      : undefined;
    const limit = clampInt(q.limit, 1, 500, 100);
    const offset = clampInt(q.offset, 0, 100_000, 0);
    const events = deps.events.list({
      ...(q.since !== undefined ? { since: q.since } : {}),
      ...(severity !== undefined ? { severity } : {}),
      ...(ancestryCategory !== undefined ? { ancestryCategory } : {}),
      ...(q.ancestryHash !== undefined ? { ancestryHash: q.ancestryHash } : {}),
      ...(q.ruleId !== undefined ? { ruleId: q.ruleId } : {}),
      limit,
      offset,
    });
    return c.json({ events, limit, offset });
  });

  r.get('/:id', c => {
    const id = c.req.param('id');
    const event = deps.events.getById(id);
    if (!event) return c.json({ error: 'not_found' }, 404);
    return c.json(event);
  });

  r.post('/:id/action', async c => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null) as { action?: string } | null;
    if (!body || !body.action || !VALID_ACTIONS.has(body.action as UserAction)) {
      return c.json({ error: 'invalid_action', valid: [...VALID_ACTIONS] }, 400);
    }
    const ok = deps.events.setUserAction(id, body.action as UserAction);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
