import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import { runSeeder } from '../src/seeder.js';
import type { FeedSource } from '../src/source.js';

function makeEntry(overrides: Partial<IoCEntry> = {}): IoCEntry {
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

function makeSource(id: string, entries: IoCEntry[]): FeedSource {
  return {
    id,
    async *refresh() {
      for (const e of entries) yield e;
    },
    async healthCheck() {
      return { ok: true, lastChecked: new Date().toISOString() };
    },
  };
}

function makeFailingSource(id: string, message: string): FeedSource {
  return {
    id,
    async *refresh(): AsyncIterable<IoCEntry> {
      throw new Error(message);
      // eslint-disable-next-line no-unreachable
      yield* [];
    },
    async healthCheck() {
      return { ok: false, lastChecked: new Date().toISOString(), message };
    },
  };
}

describe('runSeeder', () => {
  it('aggregates entries from multiple sources and dedupes via merger', async () => {
    const a = makeSource('a', [makeEntry({ sources: [{ name: 'a' }] })]);
    const b = makeSource('b', [makeEntry({ sources: [{ name: 'b' }] })]);
    const result = await runSeeder([a, b]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.sources.map(s => s.name).sort()).toEqual(['a', 'b']);
    expect(result.sourceStats).toEqual([
      { id: 'a', count: 1, ok: true },
      { id: 'b', count: 1, ok: true },
    ]);
  });

  it('continues running other sources when one fails', async () => {
    const failing = makeFailingSource('failing', 'boom');
    const ok = makeSource('ok', [makeEntry({ package: 'p1' })]);
    const result = await runSeeder([failing, ok]);
    expect(result.entries).toHaveLength(1);
    expect(result.sourceStats[0]).toEqual({
      id: 'failing',
      count: 0,
      ok: false,
      error: 'boom',
    });
    expect(result.sourceStats[1]).toEqual({ id: 'ok', count: 1, ok: true });
  });

  it('returns empty when all sources fail', async () => {
    const result = await runSeeder([
      makeFailingSource('a', 'x'),
      makeFailingSource('b', 'y'),
    ]);
    expect(result.entries).toEqual([]);
    expect(result.sourceStats.every(s => !s.ok)).toBe(true);
  });

  it('records generatedAt as ISO timestamp', async () => {
    const result = await runSeeder([makeSource('a', [])]);
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns empty for zero sources', async () => {
    const result = await runSeeder([]);
    expect(result.entries).toEqual([]);
    expect(result.sourceStats).toEqual([]);
  });
});
