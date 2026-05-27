import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeEvent, makeHarness, type TestHarness } from './helpers.js';

describe('events routes', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    h.close();
  });

  it('GET /api/events returns the list with limit/offset echoed', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'a', timestamp: '2026-05-26T10:00:00.000Z' }));
    h.deps.events.insert(makeEvent({ event_id: 'b', timestamp: '2026-05-26T11:00:00.000Z' }));
    const res = await h.app.request('/api/events?limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<{ event_id: string }>; limit: number };
    expect(body.events.map(e => e.event_id)).toEqual(['b', 'a']);
    expect(body.limit).toBe(10);
  });

  it('GET /api/events filters by severity', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'a', severity: 'critical' }));
    h.deps.events.insert(makeEvent({ event_id: 'b', severity: 'medium' }));
    const res = await h.app.request('/api/events?severity=critical');
    const body = (await res.json()) as { events: Array<{ event_id: string }> };
    expect(body.events.map(e => e.event_id)).toEqual(['a']);
  });

  it('GET /api/events ignores an invalid severity (no filter applied)', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'a' }));
    const res = await h.app.request('/api/events?severity=catastrophic');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { events: Array<unknown> };
    expect(body.events).toHaveLength(1);
  });

  it('GET /api/events clamps limit to the allowed range', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'a' }));
    const tooBig = await h.app.request('/api/events?limit=99999');
    const tooSmall = await h.app.request('/api/events?limit=0');
    expect(((await tooBig.json()) as { limit: number }).limit).toBe(500);
    expect(((await tooSmall.json()) as { limit: number }).limit).toBe(1);
  });

  it('GET /api/events/:id returns the event', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'evt-1' }));
    const res = await h.app.request('/api/events/evt-1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event_id: string };
    expect(body.event_id).toBe('evt-1');
  });

  it('GET /api/events/:id returns 404 when missing', async () => {
    const res = await h.app.request('/api/events/missing');
    expect(res.status).toBe(404);
  });

  it('POST /api/events/:id/action sets user_action', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'evt-1' }));
    const res = await h.app.request('/api/events/evt-1/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'allowlisted' }),
    });
    expect(res.status).toBe(200);
    expect(h.deps.events.getById('evt-1')?.user_action).toBe('allowlisted');
  });

  it('POST /api/events/:id/action rejects unknown action', async () => {
    h.deps.events.insert(makeEvent({ event_id: 'evt-1' }));
    const res = await h.app.request('/api/events/evt-1/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'nuke-it' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/events/:id/action returns 404 for missing event', async () => {
    const res = await h.app.request('/api/events/missing/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'dismissed' }),
    });
    expect(res.status).toBe(404);
  });
});
