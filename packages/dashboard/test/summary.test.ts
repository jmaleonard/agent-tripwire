import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEvent, makeHarness, type TestHarness } from './helpers.js';

describe('GET /api/summary', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    h.close();
  });

  it('returns counts/recent/snoozes with zero events', async () => {
    const res = await h.app.request('/api/summary');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.counts).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 });
    expect(body.recent).toEqual([]);
    expect(body.snoozes).toEqual({ active: false, kind: null, expires_at: null });
  });

  it('counts events within the last 24h, ignores older', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'old', timestamp: '2026-05-20T00:00:00.000Z' }));
    h.deps.events.insert(makeEvent({ event_id: 'recent', timestamp: '2026-05-26T10:00:00.000Z', severity: 'critical' }));
    const res = await h.app.request('/api/summary');
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts.critical).toBe(1);
    expect(body.counts.high).toBe(0);
  });

  it("returns up to 5 most-recent events in 'recent'", async () => {
    for (let i = 0; i < 7; i++) {
      const ts = `2026-05-26T11:0${i}:00.000Z`;
      h.deps.events.insert(makeEvent({ event_id: `e${i}`, timestamp: ts }));
    }
    const res = await h.app.request('/api/summary');
    const body = (await res.json()) as { recent: Array<{ event_id: string }> };
    expect(body.recent.map(r => r.event_id)).toEqual(['e6', 'e5', 'e4', 'e3', 'e2']);
  });

  it('flattens identity.category onto recent rows', async () => {
    const event = makeEvent();
    event.identity.category = 'agent-subprocess';
    h.deps.events.insert(event);
    const res = await h.app.request('/api/summary');
    const body = (await res.json()) as { recent: Array<{ ancestry_category: string }> };
    expect(body.recent[0]?.ancestry_category).toBe('agent-subprocess');
  });

  it("reports an 'all' snooze when one is active", async () => {
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T13:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request('/api/summary');
    const body = (await res.json()) as { snoozes: { active: boolean; kind: string | null } };
    expect(body.snoozes.active).toBe(true);
    expect(body.snoozes.kind).toBe('all');
  });

  it("prefers an 'all' snooze over 'this' when both are active", async () => {
    h.deps.snoozes.add({
      kind: 'this',
      rule_id: 'r',
      ancestry_hash: 'h',
      expires_at: '2026-05-26T15:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T13:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request('/api/summary');
    const body = (await res.json()) as { snoozes: { kind: string | null } };
    expect(body.snoozes.kind).toBe('all');
  });

  it("falls back to a 'this' snooze when only that is active", async () => {
    h.deps.snoozes.add({
      kind: 'this',
      rule_id: 'r',
      ancestry_hash: 'h',
      expires_at: '2026-05-26T15:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request('/api/summary');
    const body = (await res.json()) as { snoozes: { kind: string | null } };
    expect(body.snoozes.kind).toBe('this');
  });
});
