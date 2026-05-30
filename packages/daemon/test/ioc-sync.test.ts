import { createHash } from 'node:crypto';
import type { FeedManifest, IoCDelta, IoCEntry, IoCSnapshot } from '@tripwire/shared';
import { FeedStateRepository, IoCRepository, openDb, type DbHandle } from '@tripwire/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IoCSyncService } from '../src/ioc-sync.js';

const MANIFEST_URL = 'https://feed.test/manifest.json';
const FULL_URL = 'https://feed.test/latest.json';
const DELTA_URL = 'https://feed.test/delta-2026-05-29.json';

function entry(pkg: string): IoCEntry {
  return {
    ecosystem: 'npm',
    package: pkg,
    version_spec: '1.0.0',
    sources: [{ name: 'aikido' }],
    first_seen: '2026-05-14T12:00:00.000Z',
    last_seen: '2026-05-14T12:00:00.000Z',
  };
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf-8').digest('hex');

const SNAPSHOT: IoCSnapshot = {
  generated_at: '2026-05-28T06:00:00.000Z',
  date: '2026-05-28',
  entries: [entry('a'), entry('b')],
};
const SNAPSHOT_BODY = JSON.stringify(SNAPSHOT);

const DELTA: IoCDelta = {
  feed_version: 1,
  base_date: '2026-05-28',
  date: '2026-05-29',
  generated_at: '2026-05-29T06:00:00.000Z',
  added: [entry('c')],
  removed: [{ ecosystem: 'npm', package: 'b', version_spec: '1.0.0' }],
};
const DELTA_BODY = JSON.stringify(DELTA);

function manifest(): FeedManifest {
  return {
    feed_version: 1,
    generated_at: '2026-05-29T06:00:00.000Z',
    latest_date: '2026-05-29',
    full: { date: '2026-05-28', url: FULL_URL, sha256: sha(SNAPSHOT_BODY), count: 2, bytes: SNAPSHOT_BODY.length },
    deltas: [
      { date: '2026-05-29', base_date: '2026-05-28', url: DELTA_URL, sha256: sha(DELTA_BODY), added: 1, removed: 1 },
    ],
  };
}

/** Build a fetch stub keyed by URL. Manifest honours If-None-Match → 304. */
function stubFetch(m: FeedManifest, opts: { etag?: string } = {}): {
  fetch: typeof fetch;
  calls: string[];
} {
  const calls: string[] = [];
  const etag = opts.etag ?? 'W/"v1"';
  const fetchImpl = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = url.toString();
    calls.push(u);
    if (u === MANIFEST_URL) {
      const inm = (init?.headers as Record<string, string> | undefined)?.['if-none-match'];
      if (inm === etag) return new Response(null, { status: 304 });
      return new Response(JSON.stringify(m), { status: 200, headers: { etag } });
    }
    if (u === FULL_URL) return new Response(SNAPSHOT_BODY, { status: 200 });
    if (u === DELTA_URL) return new Response(DELTA_BODY, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetch: fetchImpl, calls };
}

describe('IoCSyncService', () => {
  let db: DbHandle;
  let iocs: IoCRepository;
  let feedState: FeedStateRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    iocs = new IoCRepository(db);
    feedState = new FeedStateRepository(db);
  });
  afterEach(() => db.close());

  function service(stub: { fetch: typeof fetch }): IoCSyncService {
    return new IoCSyncService({
      iocs,
      feedState,
      manifestUrl: MANIFEST_URL,
      fetch: stub.fetch,
      now: () => new Date('2026-05-30T00:00:00.000Z'),
    });
  }

  it('downloads the full snapshot then layers deltas on an empty DB', async () => {
    const result = await service(stubFetch(manifest())).sync();
    expect(result.mode).toBe('full');
    expect(result.fullDownloaded).toBe(true);
    // snapshot {a,b}; delta adds c, removes b → {a,c}
    expect(iocs.lookup('npm', 'a')).toHaveLength(1);
    expect(iocs.lookup('npm', 'b')).toHaveLength(0);
    expect(iocs.lookup('npm', 'c')).toHaveLength(1);
    expect(result.count).toBe(2);
    expect(result.added).toBe(3); // 2 full + 1 delta
    expect(result.removed).toBe(1);
    expect(result.syncedDate).toBe('2026-05-29');
    expect(feedState.get().syncedDate).toBe('2026-05-29');
    expect(feedState.get().etag).toBe('W/"v1"');
  });

  it('applies only deltas when on a contiguous chain', async () => {
    iocs.upsert(SNAPSHOT.entries);
    feedState.set({ syncedDate: '2026-05-28', etag: null, lastSyncAt: null });
    const stub = stubFetch(manifest());
    const result = await service(stub).sync();
    expect(result.mode).toBe('delta');
    expect(result.fullDownloaded).toBe(false);
    expect(stub.calls).not.toContain(FULL_URL);
    expect(iocs.lookup('npm', 'b')).toHaveLength(0);
    expect(iocs.lookup('npm', 'c')).toHaveLength(1);
    expect(result.syncedDate).toBe('2026-05-29');
  });

  it('no-ops on a 304 (ETag unchanged)', async () => {
    feedState.set({ syncedDate: '2026-05-29', etag: 'W/"v1"', lastSyncAt: null });
    const stub = stubFetch(manifest());
    const result = await service(stub).sync();
    expect(result.mode).toBe('up_to_date');
    expect(stub.calls).toEqual([MANIFEST_URL]); // only the conditional GET
  });

  it('reports up_to_date when already at latest without an ETag', async () => {
    iocs.upsert([entry('a'), entry('c')]);
    feedState.set({ syncedDate: '2026-05-29', etag: null, lastSyncAt: null });
    const result = await service(stubFetch(manifest())).sync();
    expect(result.mode).toBe('up_to_date');
  });

  it('rejects a body that fails the SHA-256 integrity check', async () => {
    const tampered = manifest();
    tampered.full.sha256 = 'deadbeef';
    await expect(service(stubFetch(tampered)).sync()).rejects.toThrow(/integrity check failed/);
  });
});
