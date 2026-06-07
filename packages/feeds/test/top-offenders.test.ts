import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import { renderTopOffendersHtml } from '../src/top-offenders-html.js';
import { computeTopOffenders } from '../src/top-offenders.js';

function ioc(over: Partial<IoCEntry> & { package: string }): IoCEntry {
  return {
    ecosystem: 'npm',
    version_spec: '1.0.0',
    sources: [{ name: 'aikido' }],
    first_seen: '2026-06-01T00:00:00.000Z',
    last_seen: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

const ENTRIES: IoCEntry[] = [
  ioc({ package: 'pkg-a', version_spec: '1.0.0', sources: [{ name: 'aikido' }, { name: 'osv' }], campaign: 'shai-hulud', first_seen: '2026-06-05T00:00:00.000Z', last_seen: '2026-06-06T00:00:00.000Z' }),
  ioc({ package: 'pkg-a', version_spec: '1.1.0', sources: [{ name: 'aikido' }], campaign: 'shai-hulud', first_seen: '2026-06-05T00:00:00.000Z', last_seen: '2026-06-06T00:00:00.000Z' }),
  ioc({ package: 'pkg-b', campaign: 'shai-hulud', first_seen: '2026-06-06T00:00:00.000Z', last_seen: '2026-06-06T00:00:00.000Z' }),
  ioc({ package: 'pkg-c', ecosystem: 'pypi', sources: [{ name: 'aikido' }, { name: 'osv' }, { name: 'ghsa' }], first_seen: '2026-06-07T00:00:00.000Z', last_seen: '2026-06-07T00:00:00.000Z' }),
  ioc({ package: 'pkg-d', campaign: 'node-ipc', first_seen: '2026-06-01T00:00:00.000Z', last_seen: '2026-06-01T00:00:00.000Z' }),
];

describe('computeTopOffenders', () => {
  it('aggregates versions per package and counts totals', () => {
    const r = computeTopOffenders(ENTRIES);
    expect(r.totalIocs).toBe(5);
    expect(r.totalPackages).toBe(4); // pkg-a's two versions collapse
    expect(r.ecosystems).toEqual({ npm: 3, pypi: 1 });
    const pkgA = r.newest.find(e => e.package === 'pkg-a');
    expect(pkgA?.versions).toBe(2);
    expect(pkgA?.sources).toEqual(['aikido', 'osv']); // unioned + sorted
  });

  it('ranks newest by first_seen desc', () => {
    const r = computeTopOffenders(ENTRIES);
    expect(r.newest[0]?.package).toBe('pkg-c'); // 06-07
    expect(r.newest[0]?.firstSeen).toBe('2026-06-07T00:00:00.000Z');
  });

  it('ranks mostSourced by distinct source count', () => {
    const r = computeTopOffenders(ENTRIES);
    expect(r.mostSourced[0]?.package).toBe('pkg-c'); // 3 sources
    expect(r.mostSourced[0]?.sources).toEqual(['aikido', 'ghsa', 'osv']);
  });

  it('groups + ranks campaigns by distinct package count', () => {
    const r = computeTopOffenders(ENTRIES);
    expect(r.campaigns[0]).toMatchObject({ campaign: 'shai-hulud', packages: 2 });
    expect(r.campaigns[1]).toMatchObject({ campaign: 'node-ipc', packages: 1 });
    expect(r.campaigns[0]?.examples).toContain('pkg-b');
  });

  it('honors the limit', () => {
    const r = computeTopOffenders(ENTRIES, { limit: 1 });
    expect(r.newest).toHaveLength(1);
    expect(r.mostSourced).toHaveLength(1);
  });
});

describe('renderTopOffendersHtml', () => {
  it('renders the sections and totals', () => {
    const html = renderTopOffendersHtml(computeTopOffenders(ENTRIES), { feedDate: '2026-06-07' });
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('pkg-c');
    expect(html).toContain('shai-hulud');
    expect(html).toContain('snapshot 2026-06-07');
  });

  it('omits the "most sources" section when the feed is single-source', () => {
    // All entries flagged by one source → the ranking is noise; don't show it.
    const single = [ioc({ package: 'x' }), ioc({ package: 'y' })];
    const html = renderTopOffendersHtml(computeTopOffenders(single));
    expect(html).not.toContain('Highest confidence');
    expect(html).toContain('Most recently flagged'); // newest always shows
  });

  it('HTML-escapes package and campaign names (no injection)', () => {
    const html = renderTopOffendersHtml(
      computeTopOffenders([ioc({ package: '<script>alert(1)</script>', campaign: 'a&b' })]),
    );
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('a&amp;b');
  });
});
