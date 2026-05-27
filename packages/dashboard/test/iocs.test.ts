import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './helpers.js';

describe('iocs routes', () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => {
    h.close();
  });

  it('GET /api/iocs (no args) returns just the count', async () => {
    h.deps.iocs.upsert([
      {
        ecosystem: 'npm',
        package: 'node-ipc',
        version_spec: '12.0.1',
        sources: [{ name: 'aikido' }],
        first_seen: '2026-05-14T12:00:00.000Z',
        last_seen: '2026-05-14T12:00:00.000Z',
      },
    ]);
    const res = await h.app.request('/api/iocs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(1);
  });

  it('GET /api/iocs?ecosystem=npm&package=… returns matching entries', async () => {
    h.deps.iocs.upsert([
      {
        ecosystem: 'npm',
        package: 'node-ipc',
        version_spec: '12.0.1',
        sources: [{ name: 'aikido' }],
        first_seen: '2026-05-14T12:00:00.000Z',
        last_seen: '2026-05-14T12:00:00.000Z',
      },
    ]);
    const res = await h.app.request('/api/iocs?ecosystem=npm&package=node-ipc');
    const body = (await res.json()) as { entries: Array<{ package: string }> };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]?.package).toBe('node-ipc');
  });

  it('GET /api/iocs rejects unknown ecosystem when package is also supplied', async () => {
    const res = await h.app.request('/api/iocs?ecosystem=weird&package=p');
    expect(res.status).toBe(400);
  });

  it('GET /api/iocs?ecosystem=npm (no package) falls back to count', async () => {
    const res = await h.app.request('/api/iocs?ecosystem=npm');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count?: number; entries?: unknown };
    expect(body.count).toBe(0);
    expect(body.entries).toBeUndefined();
  });
});
