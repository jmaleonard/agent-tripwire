import type { EventKind } from '@tripwire/shared';
import type { FsEvent } from '@tripwire/watcher';
import { Hono } from 'hono';
import type { DashboardDeps } from '../deps.js';

const VALID_KINDS = new Set<EventKind>(['read', 'write', 'open', 'create', 'unlink', 'rename']);

export function testEventRoutes(deps: DashboardDeps): Hono {
  const r = new Hono();

  r.post('/', async c => {
    if (!deps.onTestEvent) {
      return c.json(
        { error: 'test_event_not_configured', detail: 'daemon was not constructed with a test-event handler' },
        503,
      );
    }
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.path !== 'string') {
      return c.json({ error: 'path_required' }, 400);
    }
    const kind = (body.kind ?? 'read') as EventKind;
    if (!VALID_KINDS.has(kind)) {
      return c.json({ error: 'invalid_kind', valid: [...VALID_KINDS] }, 400);
    }
    const pidRaw = body.pid;
    const pid =
      pidRaw === null || pidRaw === undefined ? process.pid :
      typeof pidRaw === 'number' ? pidRaw :
      Number(pidRaw);
    if (!Number.isFinite(pid)) {
      return c.json({ error: 'invalid_pid' }, 400);
    }
    const now = (deps.now ?? (() => new Date()))();
    const fsEvent: FsEvent = {
      timestamp: now.toISOString(),
      path: body.path,
      kind,
      pid,
    };
    const emitted = await deps.onTestEvent(fsEvent);
    return c.json({
      ok: true,
      fired: emitted.length,
      events: emitted.map(e => ({
        event_id: e.event_id,
        rule_id: e.rule_id,
        severity: e.severity,
        category: e.identity.category,
        snoozed: e.snoozed,
        notified: e.notified,
      })),
    });
  });

  return r;
}
