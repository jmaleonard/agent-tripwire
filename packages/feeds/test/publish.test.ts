import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import { planPublish } from '../src/publish.js';
import { parseManifest, parseDelta, planSync, sha256Hex } from '../src/manifest.js';

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

const fullUrl = 'https://feed.test/latest.json';
const deltaUrl = (d: string): string => `https://feed.test/delta-${d}.json`;

describe('planPublish', () => {
  it('emits a full snapshot and no delta on the first run', () => {
    const plan = planPublish({
      nextEntries: [entry('a'), entry('b')],
      date: '2026-05-28',
      generatedAt: '2026-05-28T06:00:00.000Z',
      prevEntries: [],
      prevManifest: null,
      fullUrl,
      deltaUrl,
    });
    expect(plan.delta).toBeNull();
    expect(plan.deltaBody).toBeNull();
    expect(plan.manifest.deltas).toEqual([]);
    expect(plan.manifest.full.date).toBe('2026-05-28');
    expect(plan.manifest.full.count).toBe(2);
    expect(plan.manifest.full.sha256).toBe(sha256Hex(plan.snapshotBody));
  });

  it('emits a delta vs the previous snapshot and appends to the chain', () => {
    const day1 = planPublish({
      nextEntries: [entry('a'), entry('b')],
      date: '2026-05-28',
      generatedAt: '2026-05-28T06:00:00.000Z',
      prevEntries: [],
      prevManifest: null,
      fullUrl,
      deltaUrl,
    });

    const day2 = planPublish({
      nextEntries: [entry('a'), entry('c')], // dropped b, added c
      date: '2026-05-29',
      generatedAt: '2026-05-29T06:00:00.000Z',
      prevEntries: day1.snapshot.entries,
      prevManifest: day1.manifest,
      fullUrl,
      deltaUrl,
    });

    expect(day2.delta).not.toBeNull();
    expect(day2.delta!.added.map(e => e.package)).toEqual(['c']);
    expect(day2.delta!.removed.map(r => r.package)).toEqual(['b']);
    expect(day2.delta!.base_date).toBe('2026-05-28');
    expect(day2.manifest.deltas.map(d => d.date)).toEqual(['2026-05-29']);
    expect(day2.manifest.latest_date).toBe('2026-05-29');

    // The committed delta ref's sha matches the body the client will verify.
    expect(day2.manifest.deltas[0]!.sha256).toBe(sha256Hex(day2.deltaBody!));
  });

  it('produces a chain a yesterday-client resolves to a delta-only sync', () => {
    const day1 = planPublish({
      nextEntries: [entry('a'), entry('b')],
      date: '2026-05-28',
      generatedAt: 'g1',
      prevEntries: [],
      prevManifest: null,
      fullUrl,
      deltaUrl,
    });
    const day2 = planPublish({
      nextEntries: [entry('a'), entry('c')],
      date: '2026-05-29',
      generatedAt: 'g2',
      prevEntries: day1.snapshot.entries,
      prevManifest: day1.manifest,
      fullUrl,
      deltaUrl,
    });
    const manifest = parseManifest(JSON.parse(day2.manifestBody));

    // Client already at 2026-05-28 → delta-only.
    const plan = planSync(manifest, '2026-05-28');
    expect(plan.mode).toBe('delta');

    // Applying that delta to day1's entry set reproduces day2's set.
    const delta = parseDelta(JSON.parse(day2.deltaBody!));
    const set = new Map(day1.snapshot.entries.map(e => [e.package, e]));
    for (const r of delta.removed) set.delete(r.package);
    for (const a of delta.added) set.set(a.package, a);
    expect([...set.keys()].sort()).toEqual(['a', 'c']);
  });

  it('prunes the chain to keepDeltas and reports dropped dates', () => {
    let prevManifest = planPublish({
      nextEntries: [entry('a')],
      date: '2026-05-01',
      generatedAt: 'g',
      prevEntries: [],
      prevManifest: null,
      fullUrl,
      deltaUrl,
    }).manifest;
    let prevEntries: IoCEntry[] = [entry('a')];
    let lastPruned: string[] = [];

    for (let day = 2; day <= 6; day++) {
      const date = `2026-05-0${day}`;
      const next = [entry('a'), entry(`p${day}`)];
      const plan = planPublish({
        nextEntries: next,
        date,
        generatedAt: 'g',
        prevEntries,
        prevManifest,
        fullUrl,
        deltaUrl,
        keepDeltas: 2,
      });
      prevManifest = plan.manifest;
      prevEntries = next;
      lastPruned = plan.prunedDeltaDates;
    }

    // Only the 2 newest deltas survive.
    expect(prevManifest.deltas.map(d => d.date)).toEqual(['2026-05-05', '2026-05-06']);
    // The publish that pushed the chain past 2 reports the dropped date.
    expect(lastPruned).toContain('2026-05-04');
  });
});
