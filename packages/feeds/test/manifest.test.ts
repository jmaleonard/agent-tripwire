import type { FeedDeltaRef, FeedFullRef, FeedManifest } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import {
  buildManifest,
  parseManifest,
  parseSnapshot,
  parseDelta,
  planSync,
  sha256Hex,
} from '../src/manifest.js';

const full: FeedFullRef = {
  date: '2026-05-28',
  url: 'https://example.com/latest.json',
  sha256: 'abc',
  count: 100,
  bytes: 1000,
};

function deltaRef(date: string, base: string): FeedDeltaRef {
  return { date, base_date: base, url: `https://example.com/${date}.json`, sha256: 'x', added: 1, removed: 0 };
}

function manifest(overrides: Partial<FeedManifest> = {}): FeedManifest {
  return buildManifest({
    generatedAt: '2026-05-30T06:00:00.000Z',
    full,
    deltas: [deltaRef('2026-05-29', '2026-05-28'), deltaRef('2026-05-30', '2026-05-29')],
    ...overrides,
  });
}

describe('buildManifest', () => {
  it('sorts deltas and sets latest_date to the newest delta', () => {
    const m = buildManifest({
      generatedAt: 'now',
      full,
      deltas: [deltaRef('2026-05-30', '2026-05-29'), deltaRef('2026-05-29', '2026-05-28')],
    });
    expect(m.deltas.map(d => d.date)).toEqual(['2026-05-29', '2026-05-30']);
    expect(m.latest_date).toBe('2026-05-30');
  });

  it('falls back to full.date when there are no deltas', () => {
    expect(buildManifest({ generatedAt: 'now', full, deltas: [] }).latest_date).toBe('2026-05-28');
  });
});

describe('parse*', () => {
  it('round-trips a manifest through JSON', () => {
    const m = manifest();
    expect(parseManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it('rejects an unsupported feed_version', () => {
    const bad = { ...manifest(), feed_version: 99 };
    expect(() => parseManifest(bad)).toThrow(/feed_version/);
  });

  it('rejects a malformed manifest', () => {
    expect(() => parseManifest({ feed_version: 1 })).toThrow();
  });

  it('parses snapshot and delta envelopes', () => {
    expect(parseSnapshot({ generated_at: 'now', date: '2026-05-30', entries: [] }).entries).toEqual([]);
    const d = parseDelta({ feed_version: 1, base_date: 'a', date: 'b', generated_at: 'now', added: [], removed: [] });
    expect(d.date).toBe('b');
  });
});

describe('planSync', () => {
  it('returns up_to_date when synced to latest', () => {
    expect(planSync(manifest(), '2026-05-30')).toEqual({ mode: 'up_to_date' });
  });

  it('returns the delta tail when on a contiguous chain', () => {
    const plan = planSync(manifest(), '2026-05-29');
    expect(plan.mode).toBe('delta');
    if (plan.mode === 'delta') expect(plan.deltas.map(d => d.date)).toEqual(['2026-05-30']);
  });

  it('returns full + trailing deltas when the DB is empty', () => {
    const plan = planSync(manifest(), null);
    expect(plan.mode).toBe('full');
    if (plan.mode === 'full') {
      expect(plan.full.date).toBe('2026-05-28');
      expect(plan.thenDeltas.map(d => d.date)).toEqual(['2026-05-29', '2026-05-30']);
    }
  });

  it('falls back to full when the chain has a gap', () => {
    // synced to a date older than the baseline full snapshot
    const plan = planSync(manifest(), '2026-05-20');
    expect(plan.mode).toBe('full');
  });

  it('falls back to full when an intermediate delta is missing', () => {
    const gappy = buildManifest({
      generatedAt: 'now',
      full,
      deltas: [deltaRef('2026-05-30', '2026-05-29')], // missing 05-29 (base 05-28)
    });
    expect(planSync(gappy, '2026-05-28').mode).toBe('full');
  });
});

describe('sha256Hex', () => {
  it('is stable', () => {
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});
