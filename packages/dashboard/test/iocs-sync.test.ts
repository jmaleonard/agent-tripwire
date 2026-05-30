import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeHarness, type TestHarness } from './helpers.js';

describe('iocs sync routes', () => {
  let h: TestHarness;
  afterEach(() => h?.close());

  describe('GET /api/iocs/sync', () => {
    beforeEach(() => {
      h = makeHarness();
    });

    it('reports disabled when no sync hook is wired', async () => {
      const res = await h.app.request('/api/iocs/sync');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { enabled: boolean; count: number; synced_date: null };
      expect(body.enabled).toBe(false);
      expect(body.count).toBe(0);
      expect(body.synced_date).toBeNull();
    });

    it('reflects feed_state once synced', async () => {
      h.deps.feedState!.set({ syncedDate: '2026-05-30', etag: 'W/"x"', lastSyncAt: '2026-05-30T06:00:00.000Z' });
      const res = await h.app.request('/api/iocs/sync');
      const body = (await res.json()) as { synced_date: string; last_sync_at: string };
      expect(body.synced_date).toBe('2026-05-30');
      expect(body.last_sync_at).toBe('2026-05-30T06:00:00.000Z');
    });
  });

  describe('POST /api/iocs/sync', () => {
    it('returns 503 when sync is disabled', async () => {
      h = makeHarness();
      const res = await h.app.request('/api/iocs/sync', { method: 'POST' });
      expect(res.status).toBe(503);
      expect((await res.json()) as { error: string }).toEqual({ error: 'sync_disabled' });
    });

    it('invokes the hook and returns its result', async () => {
      const result = { mode: 'delta', added: 3, removed: 1, count: 42, syncedDate: '2026-05-30' };
      h = makeHarness({ onSyncIocs: async () => result });
      const res = await h.app.request('/api/iocs/sync', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(result);
    });

    it('returns 502 when the hook throws', async () => {
      h = makeHarness({
        onSyncIocs: async () => {
          throw new Error('network down');
        },
      });
      const res = await h.app.request('/api/iocs/sync', { method: 'POST' });
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: string; message: string };
      expect(body.error).toBe('sync_failed');
      expect(body.message).toBe('network down');
    });
  });
});
