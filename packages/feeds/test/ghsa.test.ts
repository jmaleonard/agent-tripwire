import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it, vi } from 'vitest';
import { GhsaFeed } from '../src/ghsa.js';

function advisory(ghsa_id: string, vulns: Array<[string, string, string | null]>, published = '2026-06-05T00:00:00Z') {
  return {
    ghsa_id,
    published_at: published,
    vulnerabilities: vulns.map(([ecosystem, name, vulnerable_version_range]) => ({
      package: { ecosystem, name },
      vulnerable_version_range,
    })),
  };
}

function jsonResponse(data: unknown, link?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (link) headers.link = link;
  return new Response(JSON.stringify(data), { status: 200, headers });
}

describe('GhsaFeed', () => {
  it('yields npm and pypi entries with GHSA attribution', async () => {
    const fetchImpl = vi.fn(async (url: string | URL): Promise<Response> => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('ecosystem=npm')) {
        return jsonResponse([advisory('GHSA-aaaa', [['npm', 'reactvora', '>= 0']])]);
      }
      if (u.includes('ecosystem=pip')) {
        return jsonResponse([advisory('GHSA-bbbb', [['pip', 'winrpcexploit', '< 2.0.0']])]);
      }
      return new Response('not found', { status: 404 });
    });
    const feed = new GhsaFeed({ fetchImpl });

    const entries: IoCEntry[] = [];
    for await (const e of feed.refresh()) entries.push(e);

    expect(entries).toHaveLength(2);

    const npm = entries.find(e => e.package === 'reactvora')!;
    expect(npm.ecosystem).toBe('npm');
    expect(npm.version_spec).toBe('*'); // ">= 0" normalized to all-versions
    expect(npm.sources).toEqual([{ name: 'ghsa', metadata: { id: 'GHSA-aaaa' } }]);
    expect(npm.first_seen).toBe('2026-06-05T00:00:00Z');

    const pypi = entries.find(e => e.package === 'winrpcexploit')!;
    expect(pypi.ecosystem).toBe('pypi'); // "pip" mapped to our "pypi"
    expect(pypi.version_spec).toBe('< 2.0.0'); // specific range kept verbatim
  });

  it('follows Link rel="next" pagination', async () => {
    const page2 = 'https://api.github.com/advisories?type=malware&ecosystem=npm&per_page=100&after=CURSOR';
    const fetchImpl = vi.fn(async (url: string | URL): Promise<Response> => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('ecosystem=pip')) return jsonResponse([]);
      if (u.includes('after=CURSOR')) {
        return jsonResponse([advisory('GHSA-p2', [['npm', 'second-page-pkg', '>= 0']])]);
      }
      // first npm page → points at page 2
      return jsonResponse([advisory('GHSA-p1', [['npm', 'first-page-pkg', '>= 0']])], `<${page2}>; rel="next"`);
    });
    const feed = new GhsaFeed({ fetchImpl });

    const names = [];
    for await (const e of feed.refresh()) names.push(e.package);

    expect(names).toContain('first-page-pkg');
    expect(names).toContain('second-page-pkg');
  });

  it('skips vulnerabilities from a different ecosystem on the page', async () => {
    const fetchImpl = vi.fn(async (url: string | URL): Promise<Response> => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.includes('ecosystem=npm')) {
        // a multi-ecosystem advisory; only the npm package belongs on this page
        return jsonResponse([advisory('GHSA-mix', [['npm', 'keep-me', '>= 0'], ['pip', 'wrong-page', '>= 0']])]);
      }
      return jsonResponse([]);
    });
    const feed = new GhsaFeed({ fetchImpl });

    const entries: IoCEntry[] = [];
    for await (const e of feed.refresh()) entries.push(e);

    expect(entries.map(e => e.package)).toEqual(['keep-me']);
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 403 }));
    const feed = new GhsaFeed({ fetchImpl });

    await expect(async () => {
      for await (const _ of feed.refresh()) void _;
    }).rejects.toThrow(/HTTP 403/);
  });

  it('sends Authorization when a token is provided', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit): Promise<Response> => {
      const auth = new Headers(init?.headers).get('authorization');
      expect(auth).toBe('Bearer tok123');
      return jsonResponse([]);
    });
    const feed = new GhsaFeed({ fetchImpl, token: 'tok123' });
    for await (const _ of feed.refresh()) void _;
    expect(fetchImpl).toHaveBeenCalled();
  });
});
