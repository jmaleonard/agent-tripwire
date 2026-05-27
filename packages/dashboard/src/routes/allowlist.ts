import type { AllowlistScope } from '@tripwire/shared';
import { Hono } from 'hono';
import type { DashboardDeps } from '../deps.js';

const VALID_SCOPES = new Set<AllowlistScope>(['rule+ancestry', 'rule+process', 'rule']);

export function allowlistRoutes(deps: DashboardDeps): Hono {
  const r = new Hono();

  r.get('/', c => c.json({ entries: deps.allowlist.list() }));

  r.post('/', async c => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.scope !== 'string' || !VALID_SCOPES.has(body.scope as AllowlistScope)) {
      return c.json({ error: 'invalid_scope' }, 400);
    }
    if (typeof body.rule_id !== 'string') {
      return c.json({ error: 'rule_id_required' }, 400);
    }
    if (body.scope === 'rule+ancestry' && typeof body.ancestry_hash !== 'string') {
      return c.json({ error: 'ancestry_hash_required' }, 400);
    }
    if (body.scope === 'rule+process' && typeof body.process_path !== 'string') {
      return c.json({ error: 'process_path_required' }, 400);
    }
    const now = (deps.now ?? (() => new Date()))();
    const created = deps.allowlist.add({
      scope: body.scope as AllowlistScope,
      rule_id: body.rule_id,
      ...(typeof body.ancestry_hash === 'string' ? { ancestry_hash: body.ancestry_hash } : {}),
      ...(typeof body.process_path === 'string' ? { process_path: body.process_path } : {}),
      ...(typeof body.path_pattern === 'string' ? { path_pattern: body.path_pattern } : {}),
      ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
      created_at: now.toISOString(),
    });
    return c.json(created, 201);
  });

  r.delete('/:id', c => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid_id' }, 400);
    const ok = deps.allowlist.remove(id);
    if (!ok) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}
