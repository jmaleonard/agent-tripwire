import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './helpers.js';

describe('server', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    h.close();
  });

  it('GET / returns the dashboard HTML shell', async () => {
    const res = await h.app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body = await res.text();
    expect(body).toContain('agent-tripwire');
    expect(body).toContain('/api/summary');
  });

  it('returns 404 for unknown api paths', async () => {
    const res = await h.app.request('/api/nonexistent');
    expect(res.status).toBe(404);
  });
});
