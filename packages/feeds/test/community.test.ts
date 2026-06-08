import type { IoCEntry } from '@tripwire/shared';
import { describe, expect, it, vi } from 'vitest';
import { CommunityFeed, parseIssueForm } from '../src/community.js';

function formBody(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `### ${k}\n\n${v === '' ? '_No response_' : v}\n`)
    .join('\n');
}

function issue(
  number: number,
  fields: Record<string, string>,
  labels: string[] = ['ioc-report', 'approved'],
  extra: Record<string, unknown> = {},
) {
  return {
    number,
    html_url: `https://github.com/jmaleonard/tripwire-feed/issues/${number}`,
    body: formBody(fields),
    created_at: '2026-06-07T12:00:00Z',
    labels: labels.map(name => ({ name })),
    ...extra,
  };
}

function jsonResponse(data: unknown, link?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (link) headers.link = link;
  return new Response(JSON.stringify(data), { status: 200, headers });
}

describe('parseIssueForm', () => {
  it('extracts headings and treats _No response_ as empty', () => {
    const body = formBody({ 'Package name': 'evil-pkg', Ecosystem: 'npm', 'Evidence link': '' });
    const f = parseIssueForm(body);
    expect(f['Package name']).toBe('evil-pkg');
    expect(f['Ecosystem']).toBe('npm');
    expect(f['Evidence link']).toBe('');
  });
});

describe('CommunityFeed', () => {
  it('yields an IoC per approved report with community-report attribution', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        issue(12, { 'Package name': 'evil-pkg', Ecosystem: 'npm', 'Affected version(s)': '1.2.0' }),
      ]),
    );
    const feed = new CommunityFeed({ fetchImpl, repo: 'jmaleonard/tripwire-feed' });

    const entries: IoCEntry[] = [];
    for await (const e of feed.refresh()) entries.push(e);

    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.ecosystem).toBe('npm');
    expect(e.package).toBe('evil-pkg');
    expect(e.version_spec).toBe('1.2.0');
    expect(e.sources).toEqual([
      { name: 'community-report', metadata: { issue: 12, url: 'https://github.com/jmaleonard/tripwire-feed/issues/12' } },
    ]);
    expect(e.first_seen).toBe('2026-06-07T12:00:00Z');
  });

  it('maps pip->pypi and normalizes "all"/blank versions to *', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        issue(1, { 'Package name': 'a', Ecosystem: 'pip', 'Affected version(s)': 'all' }),
        issue(2, { 'Package name': 'b', Ecosystem: 'PyPI', 'Affected version(s)': '' }),
      ]),
    );
    const feed = new CommunityFeed({ fetchImpl });

    const entries: IoCEntry[] = [];
    for await (const e of feed.refresh()) entries.push(e);

    expect(entries.map(e => [e.ecosystem, e.version_spec])).toEqual([
      ['pypi', '*'],
      ['pypi', '*'],
    ]);
  });

  it('skips issues already labeled ingested', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        issue(1, { 'Package name': 'fresh', Ecosystem: 'npm' }, ['ioc-report', 'approved']),
        issue(2, { 'Package name': 'done', Ecosystem: 'npm' }, ['ioc-report', 'approved', 'ingested']),
      ]),
    );
    const feed = new CommunityFeed({ fetchImpl });

    const names = [];
    for await (const e of feed.refresh()) names.push(e.package);
    expect(names).toEqual(['fresh']);
  });

  it('skips pull requests and reports with no package name', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        issue(1, { 'Package name': '', Ecosystem: 'npm' }), // malformed
        issue(2, { 'Package name': 'real', Ecosystem: 'npm' }, ['ioc-report', 'approved'], {
          pull_request: { url: 'x' },
        }), // a PR
        issue(3, { 'Package name': 'keep', Ecosystem: 'npm' }),
      ]),
    );
    const feed = new CommunityFeed({ fetchImpl });

    const names = [];
    for await (const e of feed.refresh()) names.push(e.package);
    expect(names).toEqual(['keep']);
  });

  it('queries open ioc-report + approved issues', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      expect(u).toContain('/repos/jmaleonard/tripwire-feed/issues');
      expect(u).toContain('state=open');
      expect(decodeURIComponent(u)).toContain('labels=ioc-report,approved');
      return jsonResponse([]);
    });
    const feed = new CommunityFeed({ fetchImpl });
    for await (const _ of feed.refresh()) void _;
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 }));
    const feed = new CommunityFeed({ fetchImpl });
    await expect(async () => {
      for await (const _ of feed.refresh()) void _;
    }).rejects.toThrow(/HTTP 404/);
  });
});
