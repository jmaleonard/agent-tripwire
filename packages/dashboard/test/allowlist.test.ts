import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './helpers.js';

describe('allowlist routes', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    h.close();
  });

  it('GET /api/allowlist returns the current entries', async () => {
    h.deps.allowlist.add({
      scope: 'rule',
      rule_id: 'cred.aws',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request('/api/allowlist');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: Array<unknown> };
    expect(body.entries).toHaveLength(1);
  });

  it('POST /api/allowlist creates a rule-scoped entry', async () => {
    const res = await h.app.request('/api/allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'rule', rule_id: 'cred.aws', reason: 'AWS CLI is fine' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; reason: string };
    expect(body.id).toBeGreaterThan(0);
    expect(body.reason).toBe('AWS CLI is fine');
  });

  it("POST /api/allowlist requires ancestry_hash for scope='rule+ancestry'", async () => {
    const res = await h.app.request('/api/allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'rule+ancestry', rule_id: 'cred.aws' }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/allowlist requires process_path for scope='rule+process'", async () => {
    const res = await h.app.request('/api/allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'rule+process', rule_id: 'cred.aws' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/allowlist rejects unknown scope', async () => {
    const res = await h.app.request('/api/allowlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'forever', rule_id: 'cred.aws' }),
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/allowlist/:id removes the entry', async () => {
    const entry = h.deps.allowlist.add({
      scope: 'rule',
      rule_id: 'cred.aws',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const res = await h.app.request(`/api/allowlist/${entry.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(h.deps.allowlist.list()).toEqual([]);
  });

  it('DELETE /api/allowlist/:id returns 404 for unknown id', async () => {
    const res = await h.app.request('/api/allowlist/9999', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
