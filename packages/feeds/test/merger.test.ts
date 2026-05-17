import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import { mergeFeeds } from '../src/merger.js';

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

describe('mergeFeeds', () => {
  it('dedupes by (ecosystem, package, version_spec)', () => {
    const merged = mergeFeeds([
      makeEntry({ sources: [{ name: 'aikido' }] }),
      makeEntry({ sources: [{ name: 'osv' }] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources.map(s => s.name).sort()).toEqual(['aikido', 'osv']);
  });

  it('does not add a duplicate source on re-merge', () => {
    const merged = mergeFeeds([
      makeEntry({ sources: [{ name: 'aikido' }] }),
      makeEntry({ sources: [{ name: 'aikido' }] }),
    ]);
    expect(merged[0]!.sources).toHaveLength(1);
  });

  it('preserves earliest first_seen and latest last_seen', () => {
    const merged = mergeFeeds([
      makeEntry({
        first_seen: '2026-05-14T12:00:00.000Z',
        last_seen: '2026-05-14T12:00:00.000Z',
      }),
      makeEntry({
        first_seen: '2026-05-16T12:00:00.000Z',
        last_seen: '2026-05-16T12:00:00.000Z',
      }),
    ]);
    expect(merged[0]!.first_seen).toBe('2026-05-14T12:00:00.000Z');
    expect(merged[0]!.last_seen).toBe('2026-05-16T12:00:00.000Z');
  });

  it('keeps a non-empty campaign when one source has it and another does not', () => {
    const merged = mergeFeeds([
      makeEntry(),
      makeEntry({ campaign: 'mini-shai-hulud' }),
    ]);
    expect(merged[0]!.campaign).toBe('mini-shai-hulud');
  });

  it('treats different ecosystems as distinct entries', () => {
    const merged = mergeFeeds([
      makeEntry({ ecosystem: 'npm' }),
      makeEntry({ ecosystem: 'pypi' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('treats different version specs as distinct entries', () => {
    const merged = mergeFeeds([
      makeEntry({ version_spec: '1.0.0' }),
      makeEntry({ version_spec: '2.0.0' }),
    ]);
    expect(merged).toHaveLength(2);
  });

  it('does not mutate the input entry objects', () => {
    const a = makeEntry({ sources: [{ name: 'aikido' }] });
    const b = makeEntry({ sources: [{ name: 'osv' }] });
    mergeFeeds([a, b]);
    expect(a.sources).toHaveLength(1);
    expect(b.sources).toHaveLength(1);
  });
});
