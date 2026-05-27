import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './helpers.js';

describe('snoozes routes', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    h.close();
  });

  it("GET /api/snoozes returns active snoozes by default", async () => {
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T13:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T10:00:00.000Z',
      created_at: '2026-05-26T08:00:00.000Z',
    });
    const res = await h.app.request('/api/snoozes');
    const body = (await res.json()) as { snoozes: Array<{ expires_at: string }> };
    expect(body.snoozes).toHaveLength(1);
  });

  it('GET /api/snoozes?active=false returns all (including expired)', async () => {
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T10:00:00.000Z',
      created_at: '2026-05-26T08:00:00.000Z',
    });
    const res = await h.app.request('/api/snoozes?active=false');
    const body = (await res.json()) as { snoozes: Array<unknown> };
    expect(body.snoozes).toHaveLength(1);
  });

  it('POST /api/snoozes creates an "all" snooze', async () => {
    const res = await h.app.request('/api/snoozes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'all', expires_at: '2026-05-26T13:00:00.000Z' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; kind: string };
    expect(body.kind).toBe('all');
    expect(body.id).toBeGreaterThan(0);
  });

  it('POST /api/snoozes requires rule_id+ancestry_hash for kind=this', async () => {
    const res = await h.app.request('/api/snoozes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'this', expires_at: '2026-05-26T13:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/snoozes rejects unknown kind', async () => {
    const res = await h.app.request('/api/snoozes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'forever', expires_at: '2026-05-26T13:00:00.000Z' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/snoozes/:id clears just that snooze', async () => {
    const s1 = h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T13:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T14:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request(`/api/snoozes/${s1.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBe(1);
    expect(h.deps.snoozes.list()).toHaveLength(1);
  });

  it('DELETE /api/snoozes clears every snooze', async () => {
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T13:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    h.deps.snoozes.add({
      kind: 'all',
      expires_at: '2026-05-26T14:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request('/api/snoozes', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { removed: number };
    expect(body.removed).toBe(2);
    expect(h.deps.snoozes.list()).toEqual([]);
  });
});
