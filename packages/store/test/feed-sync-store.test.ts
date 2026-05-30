import type { IoCEntry } from '@tripwire/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db.js';
import { openDb } from '../src/db.js';
import { FeedStateRepository } from '../src/feed-state.js';
import { IoCRepository } from '../src/iocs.js';

function entry(overrides: Partial<IoCEntry> = {}): IoCEntry {
  return {
    ecosystem: 'npm',
    package: 'node-ipc',
    version_spec: '12.0.1',
    sources: [{ name: 'aikido' }],
    first_seen: '2026-05-14T12:00:00.000Z',
    last_seen: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('IoCRepository.remove / replaceAll', () => {
  let db: DbHandle;
  let repo: IoCRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new IoCRepository(db);
  });
  afterEach(() => db.close());

  it('removes by identity tuple', () => {
    repo.upsert([entry({ package: 'a' }), entry({ package: 'b' })]);
    const { count } = repo.remove([{ ecosystem: 'npm', package: 'b', version_spec: '12.0.1' }]);
    expect(count).toBe(1);
    expect(repo.count()).toBe(1);
    expect(repo.lookup('npm', 'b')).toEqual([]);
  });

  it('remove ignores tuples that are not present', () => {
    repo.upsert([entry({ package: 'a' })]);
    expect(repo.remove([{ ecosystem: 'npm', package: 'ghost', version_spec: '9' }]).count).toBe(0);
    expect(repo.count()).toBe(1);
  });

  it('replaceAll swaps the whole table, dropping stale rows', () => {
    repo.upsert([entry({ package: 'old' })]);
    repo.replaceAll([entry({ package: 'new1' }), entry({ package: 'new2' })]);
    expect(repo.count()).toBe(2);
    expect(repo.lookup('npm', 'old')).toEqual([]);
    expect(repo.lookup('npm', 'new1')).toHaveLength(1);
  });
});

describe('FeedStateRepository', () => {
  let db: DbHandle;
  let repo: FeedStateRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new FeedStateRepository(db);
  });
  afterEach(() => db.close());

  it('defaults to an empty state', () => {
    expect(repo.get()).toEqual({ syncedDate: null, etag: null, lastSyncAt: null });
  });

  it('persists and overwrites the single row', () => {
    repo.set({ syncedDate: '2026-05-30', etag: 'W/"abc"', lastSyncAt: '2026-05-30T06:00:00.000Z' });
    expect(repo.get()).toEqual({
      syncedDate: '2026-05-30',
      etag: 'W/"abc"',
      lastSyncAt: '2026-05-30T06:00:00.000Z',
    });
    repo.set({ syncedDate: '2026-05-31', etag: null, lastSyncAt: '2026-05-31T06:00:00.000Z' });
    expect(repo.get().syncedDate).toBe('2026-05-31');
    expect(repo.get().etag).toBeNull();
  });
});
