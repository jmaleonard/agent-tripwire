import type { IoCEntry } from '@tripwire/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db.js';
import { openDb } from '../src/db.js';
import { IoCRepository } from '../src/iocs.js';

function makeEntry(overrides: Partial<IoCEntry> = {}): IoCEntry {
  return {
    ecosystem: 'npm',
    package: 'node-ipc',
    version_spec: '12.0.1',
    sources: [{ name: 'aikido' }],
    campaign: 'node-ipc-2026-05',
    first_seen: '2026-05-14T12:00:00.000Z',
    last_seen: '2026-05-14T12:00:00.000Z',
    ...overrides,
  };
}

describe('IoCRepository', () => {
  let db: DbHandle;
  let repo: IoCRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new IoCRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upserts and counts', () => {
    repo.upsert([makeEntry(), makeEntry({ package: 'evil-pkg', version_spec: '1.0.0' })]);
    expect(repo.count()).toBe(2);
  });

  it('lookup by ecosystem + package returns all matching versions', () => {
    repo.upsert([
      makeEntry({ package: 'a', version_spec: '1.0.0' }),
      makeEntry({ package: 'a', version_spec: '2.0.0' }),
      makeEntry({ package: 'b', version_spec: '1.0.0' }),
    ]);
    const aEntries = repo.lookup('npm', 'a');
    expect(aEntries.map(e => e.version_spec).sort()).toEqual(['1.0.0', '2.0.0']);
  });

  it('upsert preserves first_seen and updates last_seen/sources on conflict', () => {
    repo.upsert([
      makeEntry({
        sources: [{ name: 'osv' }],
        first_seen: '2026-05-14T12:00:00.000Z',
        last_seen: '2026-05-14T12:00:00.000Z',
      }),
    ]);
    repo.upsert([
      makeEntry({
        sources: [{ name: 'osv' }, { name: 'aikido' }],
        first_seen: '2026-05-15T12:00:00.000Z',
        last_seen: '2026-05-15T12:00:00.000Z',
      }),
    ]);

    expect(repo.count()).toBe(1);
    const after = repo.lookup('npm', 'node-ipc')[0]!;
    expect(after.first_seen).toBe('2026-05-14T12:00:00.000Z');
    expect(after.last_seen).toBe('2026-05-15T12:00:00.000Z');
    expect(after.sources).toHaveLength(2);
  });

  it('upsert preserves campaign when COALESCED with null', () => {
    repo.upsert([makeEntry({ campaign: 'mini-shai-hulud' })]);
    const updated = makeEntry({ last_seen: '2026-05-20T12:00:00.000Z' });
    delete updated.campaign;
    repo.upsert([updated]);
    expect(repo.lookup('npm', 'node-ipc')[0]?.campaign).toBe('mini-shai-hulud');
  });

  it('returns empty array for unknown package', () => {
    expect(repo.lookup('npm', 'nonexistent')).toEqual([]);
  });

  it('list respects limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      repo.upsert([
        makeEntry({
          package: `p-${i}`,
          version_spec: '1.0.0',
          last_seen: `2026-05-${10 + i}T00:00:00.000Z`,
        }),
      ]);
    }
    expect(repo.list({ limit: 2 }).map(e => e.package)).toEqual(['p-4', 'p-3']);
    expect(repo.list({ limit: 2, offset: 2 }).map(e => e.package)).toEqual(['p-2', 'p-1']);
  });
});
