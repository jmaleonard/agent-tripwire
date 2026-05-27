import type { TripwireEvent } from '@tripwire/shared';
import type { FsEvent } from '@tripwire/watcher';
import {
  AllowlistRepository,
  EventRepository,
  IoCRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDashboard } from '../src/server.js';
import type { DashboardDeps } from '../src/deps.js';

function makeDeps(overrides: Partial<DashboardDeps> = {}): { app: ReturnType<typeof createDashboard>; deps: DashboardDeps; db: DbHandle } {
  const db = openDb({ path: ':memory:' });
  const deps: DashboardDeps = {
    events: new EventRepository(db),
    snoozes: new SnoozeRepository(db),
    allowlist: new AllowlistRepository(db),
    iocs: new IoCRepository(db),
    ...overrides,
  };
  return { app: createDashboard(deps), deps, db };
}

describe('POST /api/test-event', () => {
  let db: DbHandle;

  afterEach(() => {
    db?.close();
  });

  it('returns 503 when no onTestEvent handler is wired', async () => {
    const h = makeDeps();
    db = h.db;
    const res = await h.app.request('/api/test-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/x', kind: 'read' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('test_event_not_configured');
  });

  it('calls the handler and echoes the events', async () => {
    const fakeEvent: TripwireEvent = {
      event_id: 'evt-fake',
      timestamp: '2026-05-27T12:00:00.000Z',
      source: 'fs_watcher',
      severity: 'high',
      rule_id: 'cred.aws-credentials-read',
      identity: {
        pid: 4421,
        process_path: '/node',
        argv: ['node'],
        parent_agent_session_id: null,
        ancestry_summary_hash: 'h',
        category: 'agent-subprocess',
      },
      snoozed: false,
      notified: true,
      user_action: 'pending',
    };
    const handler = vi.fn(async (_fsEvent: FsEvent) => [fakeEvent]);
    const h = makeDeps({ onTestEvent: handler });
    db = h.db;
    const res = await h.app.request('/api/test-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/Users/test/.aws/credentials', kind: 'read', pid: 4421 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fired: number; events: Array<{ rule_id: string }> };
    expect(body.fired).toBe(1);
    expect(body.events[0]?.rule_id).toBe('cred.aws-credentials-read');
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].path).toBe('/Users/test/.aws/credentials');
    expect(handler.mock.calls[0]![0].pid).toBe(4421);
  });

  it('defaults missing pid to process.pid', async () => {
    const handler = vi.fn(async (_fsEvent: FsEvent) => []);
    const h = makeDeps({ onTestEvent: handler });
    db = h.db;
    await h.app.request('/api/test-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/x' }),
    });
    expect(handler.mock.calls[0]![0].pid).toBe(process.pid);
  });

  it('rejects missing path', async () => {
    const handler = vi.fn(async () => []);
    const h = makeDeps({ onTestEvent: handler });
    db = h.db;
    const res = await h.app.request('/api/test-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'read' }),
    });
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects invalid event kind', async () => {
    const handler = vi.fn(async () => []);
    const h = makeDeps({ onTestEvent: handler });
    db = h.db;
    const res = await h.app.request('/api/test-event', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: '/x', kind: 'caress' }),
    });
    expect(res.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});
