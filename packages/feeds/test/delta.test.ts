import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import { computeDelta, iocKey } from '../src/delta.js';

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

const OPTS = { baseDate: '2026-05-29', date: '2026-05-30', generatedAt: '2026-05-30T06:00:00.000Z' };

describe('computeDelta', () => {
  it('reports newly added entries', () => {
    const prev = [entry({ package: 'a' })];
    const next = [entry({ package: 'a' }), entry({ package: 'b' })];
    const d = computeDelta(prev, next, OPTS);
    expect(d.added.map(e => e.package)).toEqual(['b']);
    expect(d.removed).toEqual([]);
    expect(d.base_date).toBe('2026-05-29');
    expect(d.date).toBe('2026-05-30');
  });

  it('reports removed entries as identity tuples', () => {
    const prev = [entry({ package: 'a' }), entry({ package: 'b' })];
    const next = [entry({ package: 'a' })];
    const d = computeDelta(prev, next, OPTS);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([
      { ecosystem: 'npm', package: 'b', version_spec: '12.0.1' },
    ]);
  });

  it('treats a changed entry (new source / last_seen) as added', () => {
    const prev = [entry({ sources: [{ name: 'aikido' }] })];
    const next = [entry({ sources: [{ name: 'aikido' }, { name: 'osv' }] })];
    const d = computeDelta(prev, next, OPTS);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toEqual([]);
  });

  it('emits an empty delta for identical snapshots', () => {
    const snap = [entry({ package: 'a' }), entry({ package: 'b' })];
    const d = computeDelta(snap, snap, OPTS);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('keys on ecosystem + package + version', () => {
    expect(iocKey(entry())).toBe('npm\x00node-ipc\x0012.0.1');
    const prev = [entry({ version_spec: '1.0.0' })];
    const next = [entry({ version_spec: '2.0.0' })];
    const d = computeDelta(prev, next, OPTS);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
  });
});
