import type { Ecosystem, IoCEntry } from '@tripwire/shared';
import { githubHeaders, nextLink } from './github.js';
import type { FeedHealth, FeedSource, RefreshOptions } from './source.js';

export interface CommunityFeedOptions {
  /** owner/name of the repo whose issues hold the reports. */
  repo?: string;
  /** GitHub token with issues:read (the workflow's GITHUB_TOKEN). */
  token?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Label a report must carry to be a report at all. */
  reportLabel?: string;
  /** Label a maintainer adds to approve a report for ingestion. */
  approvedLabel?: string;
  /** Label applied once a report is in the feed; such issues are skipped. */
  ingestedLabel?: string;
  maxPages?: number;
}

interface GithubLabel {
  name: string;
}

interface GithubIssue {
  number: number;
  html_url: string;
  body: string | null;
  created_at: string | null;
  labels: Array<GithubLabel | string> | null;
  pull_request?: unknown;
}

/**
 * Community-reported malicious packages, sourced from this repo's own GitHub
 * issues. Reports arrive via the issue form (label `ioc-report`); a maintainer
 * vets one by adding `approved`. This source reads **approved, not-yet-ingested**
 * reports and yields them as IoC entries with `community-report` attribution —
 * the moderation gate means nothing a stranger submits reaches the feed until a
 * human approves it. The workflow marks issues `ingested` after a successful
 * publish so they are not re-ingested.
 */
export class CommunityFeed implements FeedSource {
  readonly id = 'community';

  private readonly repo: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly reportLabel: string;
  private readonly approvedLabel: string;
  private readonly ingestedLabel: string;
  private readonly maxPages: number;

  constructor(opts: CommunityFeedOptions = {}) {
    this.repo = opts.repo ?? 'jmaleonard/tripwire-feed';
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://api.github.com';
    this.reportLabel = opts.reportLabel ?? 'ioc-report';
    this.approvedLabel = opts.approvedLabel ?? 'approved';
    this.ingestedLabel = opts.ingestedLabel ?? 'ingested';
    this.maxPages = opts.maxPages ?? 50;
  }

  async *refresh(opts: RefreshOptions = {}): AsyncIterable<IoCEntry> {
    const fetchImpl = opts.fetch ?? this.fetchImpl;
    const now = new Date().toISOString();
    const labels = `${this.reportLabel},${this.approvedLabel}`;
    let url: string | null =
      `${this.baseUrl}/repos/${this.repo}/issues?state=open&labels=${encodeURIComponent(labels)}&per_page=100`;
    let pages = 0;

    while (url && pages < this.maxPages) {
      const res = await fetchImpl(url, {
        headers: githubHeaders(this.token),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      if (!res.ok) {
        throw new Error(`Community issues ${url} returned HTTP ${res.status}`);
      }
      const issues = (await res.json()) as GithubIssue[];
      if (!Array.isArray(issues)) {
        throw new Error(`Community issues ${url} did not return an array`);
      }

      for (const issue of issues) {
        // The issues endpoint also lists pull requests — skip them.
        if (issue.pull_request) continue;
        const names = (issue.labels ?? []).map(l => (typeof l === 'string' ? l : l.name));
        if (names.includes(this.ingestedLabel)) continue;

        const fields = parseIssueForm(issue.body ?? '');
        const pkg = (fields['Package name'] ?? '').trim();
        if (!pkg) continue; // malformed report — no package, nothing to flag

        const seen = issue.created_at ?? now;
        yield {
          ecosystem: normalizeEcosystem(fields['Ecosystem'] ?? ''),
          package: pkg,
          version_spec: normalizeVersion(fields['Affected version(s)'] ?? ''),
          sources: [
            {
              name: 'community-report',
              metadata: { issue: issue.number, url: issue.html_url },
            },
          ],
          first_seen: seen,
          last_seen: seen,
        };
      }

      url = nextLink(res.headers.get('link'));
      pages++;
    }
  }

  async healthCheck(): Promise<FeedHealth> {
    const lastChecked = new Date().toISOString();
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/repos/${this.repo}`, {
        headers: githubHeaders(this.token),
      });
      return res.ok
        ? { ok: true, lastChecked }
        : { ok: false, message: `HTTP ${res.status}`, lastChecked };
    } catch (err) {
      return { ok: false, message: (err as Error).message, lastChecked };
    }
  }
}

/**
 * Parse a GitHub issue-form body into { heading: value }. Issue forms render
 * each field as a `### <Label>` heading followed by the value (or
 * `_No response_` when left blank).
 */
export function parseIssueForm(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split(/^### /m)) {
    const nl = part.indexOf('\n');
    if (nl === -1) continue;
    const heading = part.slice(0, nl).trim();
    if (!heading) continue;
    const value = part.slice(nl + 1).trim();
    out[heading] = value === '_No response_' ? '' : value;
  }
  return out;
}

function normalizeEcosystem(s: string): Ecosystem {
  const v = s.trim().toLowerCase();
  if (v === 'npm') return 'npm';
  if (v === 'pypi' || v === 'pip') return 'pypi';
  return 'other';
}

/** Blank, "all", or "*" all mean "every version" — match the feed's `*`
 *  convention so a report corroborates with the bulk feeds on the dedup key. */
function normalizeVersion(s: string): string {
  const v = s.trim();
  if (!v || v.toLowerCase() === 'all' || v === '*') return '*';
  return v;
}
