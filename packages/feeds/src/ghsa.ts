import type { Ecosystem, IoCEntry } from '@tripwire/shared';
import { githubHeaders, nextLink } from './github.js';
import type { FeedHealth, FeedSource, RefreshOptions } from './source.js';

export const GHSA_ADVISORIES_URL = 'https://api.github.com/advisories';

/** GitHub's advisory ecosystem slug -> our {@link Ecosystem}. GitHub calls
 *  PyPI "pip"; we call it "pypi". */
const ECOSYSTEMS: ReadonlyArray<{ slug: string; ecosystem: Ecosystem }> = [
  { slug: 'npm', ecosystem: 'npm' },
  { slug: 'pip', ecosystem: 'pypi' },
];

interface GhsaVulnerability {
  package: { ecosystem: string; name: string } | null;
  vulnerable_version_range: string | null;
}

interface GhsaAdvisory {
  ghsa_id: string;
  published_at: string | null;
  vulnerabilities: GhsaVulnerability[] | null;
}

export interface GhsaFeedOptions {
  /** GitHub token. Optional, but unauthenticated requests are capped at 60/hr,
   *  which the malware corpus exceeds — pass the workflow's GITHUB_TOKEN. */
  token?: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  /** Safety cap on pages per ecosystem (defends against a pagination loop). */
  maxPages?: number;
}

/**
 * GitHub Advisory Database — malware advisories only
 * (`GET /advisories?type=malware`). GitHub aggregates these from the OpenSSF
 * Malicious Packages project and its own GHSA curation, returning *only*
 * malicious-package records as paginated JSON. That makes it the practical free
 * route to OpenSSF/OSV malware signal: the raw OSV bulk export is a ~200MB zip
 * and the OpenSSF repo is thousands of per-package files, both far heavier than
 * this for the same data.
 *
 * Attribution surfaces per entry as `sources[].metadata.id` (the GHSA id).
 */
export class GhsaFeed implements FeedSource {
  readonly id = 'ghsa';

  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxPages: number;

  constructor(opts: GhsaFeedOptions = {}) {
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.baseUrl = opts.baseUrl ?? GHSA_ADVISORIES_URL;
    this.maxPages = opts.maxPages ?? 100;
  }

  async *refresh(opts: RefreshOptions = {}): AsyncIterable<IoCEntry> {
    const fetchImpl = opts.fetch ?? this.fetchImpl;
    const now = new Date().toISOString();

    for (const { slug, ecosystem } of ECOSYSTEMS) {
      let url: string | null = `${this.baseUrl}?type=malware&ecosystem=${slug}&per_page=100`;
      let pages = 0;

      while (url && pages < this.maxPages) {
        const res = await fetchImpl(url, {
          headers: githubHeaders(this.token),
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
        if (!res.ok) {
          throw new Error(`GHSA advisories ${url} returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as GhsaAdvisory[];
        if (!Array.isArray(data)) {
          throw new Error(`GHSA advisories ${url} did not return an array`);
        }

        for (const adv of data) {
          const seen = adv.published_at ?? now;
          for (const vuln of adv.vulnerabilities ?? []) {
            // An advisory can list packages from several ecosystems; keep only
            // the one this page is paginating.
            if (!vuln.package || vuln.package.ecosystem !== slug) continue;
            yield {
              ecosystem,
              package: vuln.package.name,
              version_spec: normalizeRange(vuln.vulnerable_version_range),
              sources: [{ name: 'ghsa', metadata: { id: adv.ghsa_id } }],
              first_seen: seen,
              last_seen: seen,
            };
          }
        }

        url = nextLink(res.headers.get('link'));
        pages++;
      }
    }
  }

  async healthCheck(): Promise<FeedHealth> {
    const lastChecked = new Date().toISOString();
    try {
      const res = await this.fetchImpl(`${this.baseUrl}?type=malware&ecosystem=npm&per_page=1`, {
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
 * Malware advisories almost always apply to every published version, expressed
 * as ">= 0". Normalize that to '*' so it shares a dedup key with Aikido's
 * all-versions convention and the two feeds corroborate. Specific ranges are
 * kept verbatim.
 */
function normalizeRange(range: string | null): string {
  if (!range || range.trim() === '>= 0') return '*';
  return range.trim();
}
