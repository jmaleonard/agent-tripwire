import type { Ecosystem, IoCEntry } from '@tripwire/shared';
import type { FeedHealth, FeedSource, RefreshOptions } from './source.js';

export const AIKIDO_NPM_URL = 'https://malware-list.aikido.dev/malware_predictions.json';
export const AIKIDO_PYPI_URL = 'https://malware-list.aikido.dev/malware_pypi.json';

interface AikidoRecord {
  package_name: string;
  version: string;
  reason: string;
}

export interface AikidoFeedOptions {
  npmUrl?: string;
  pypiUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Aikido public malware list. Two endpoints, same schema:
 *   [{ "package_name": "...", "version": "...", "reason": "MALWARE" }, ...]
 *
 * Aggregated signal from OSV, GHSA, and Aikido's own ML — see spec §5.2.
 * Attribution: Aikido publishes these as a public good; the README
 * acknowledges them.
 */
export class AikidoFeed implements FeedSource {
  readonly id = 'aikido';

  private readonly npmUrl: string;
  private readonly pypiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AikidoFeedOptions = {}) {
    this.npmUrl = opts.npmUrl ?? AIKIDO_NPM_URL;
    this.pypiUrl = opts.pypiUrl ?? AIKIDO_PYPI_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async *refresh(opts: RefreshOptions = {}): AsyncIterable<IoCEntry> {
    const fetchImpl = opts.fetch ?? this.fetchImpl;
    const now = new Date().toISOString();
    const targets: Array<{ url: string; ecosystem: Ecosystem }> = [
      { url: this.npmUrl, ecosystem: 'npm' },
      { url: this.pypiUrl, ecosystem: 'pypi' },
    ];
    for (const { url, ecosystem } of targets) {
      const res = await fetchImpl(url, opts.signal ? { signal: opts.signal } : {});
      if (!res.ok) {
        throw new Error(`Aikido feed ${url} returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as AikidoRecord[];
      if (!Array.isArray(data)) {
        throw new Error(`Aikido feed ${url} did not return an array`);
      }
      for (const record of data) {
        yield {
          ecosystem,
          package: record.package_name,
          version_spec: record.version,
          sources: [
            {
              name: 'aikido',
              metadata: { reason: record.reason },
            },
          ],
          first_seen: now,
          last_seen: now,
        };
      }
    }
  }

  async healthCheck(): Promise<FeedHealth> {
    const lastChecked = new Date().toISOString();
    try {
      const res = await this.fetchImpl(this.npmUrl, { method: 'HEAD' });
      return res.ok
        ? { ok: true, lastChecked }
        : { ok: false, message: `HTTP ${res.status}`, lastChecked };
    } catch (err) {
      return { ok: false, message: (err as Error).message, lastChecked };
    }
  }
}
