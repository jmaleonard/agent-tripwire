import type { Logger } from '@tripwire/shared';
import {
  parseDelta,
  parseManifest,
  parseSnapshot,
  planSync,
  sha256Hex,
  type SyncPlan,
} from '@tripwire/feeds';
import type { FeedDeltaRef, FeedManifest } from '@tripwire/shared';
import type { FeedStateRepository, IoCRepository } from '@tripwire/store';

/** Default manifest location: raw file in the public feed repo. */
export const DEFAULT_FEED_MANIFEST_URL =
  'https://raw.githubusercontent.com/jmaleonard/tripwire-feed/main/feed/v1/manifest.json';

export interface IoCSyncOptions {
  iocs: IoCRepository;
  feedState: FeedStateRepository;
  /** URL of the feed manifest. Defaults to {@link DEFAULT_FEED_MANIFEST_URL}. */
  manifestUrl?: string;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetch?: typeof fetch;
  logger?: Logger;
  now?: () => Date;
}

export type SyncMode = 'up_to_date' | 'full' | 'delta';

export interface SyncResult {
  mode: SyncMode;
  /** True if the full snapshot was downloaded this run. */
  fullDownloaded: boolean;
  deltasApplied: number;
  added: number;
  removed: number;
  /** Total IoC rows in the local DB after the sync. */
  count: number;
  /** Date the local DB is now current as of. */
  syncedDate: string | null;
}

/**
 * Pulls the published IoC feed into the local SQLite store. On each run it
 * fetches the manifest (conditional GET via ETag), then either downloads the
 * full snapshot (empty/too-far-behind) or applies just the missing deltas.
 * All downloads are integrity-checked against the manifest's SHA-256 refs.
 */
export class IoCSyncService {
  private readonly iocs: IoCRepository;
  private readonly feedState: FeedStateRepository;
  private readonly manifestUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly logger: Logger | undefined;
  private readonly now: () => Date;

  constructor(opts: IoCSyncOptions) {
    this.iocs = opts.iocs;
    this.feedState = opts.feedState;
    this.manifestUrl = opts.manifestUrl ?? DEFAULT_FEED_MANIFEST_URL;
    this.doFetch = opts.fetch ?? globalThis.fetch;
    this.logger = opts.logger;
    this.now = opts.now ?? (() => new Date());
  }

  private inflight: Promise<SyncResult> | undefined;

  /**
   * Pull the feed. Reentrant-safe: concurrent callers (startup sync, the 6h
   * timer, a manual `ioc sync`) share one in-flight run rather than each
   * downloading the snapshot and racing on `replaceAll`.
   */
  async sync(): Promise<SyncResult> {
    if (this.inflight) return this.inflight;
    this.inflight = this.runSync().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async runSync(): Promise<SyncResult> {
    const state = this.feedState.get();

    const manifestRes = await this.doFetch(this.manifestUrl, {
      headers: state.etag ? { 'if-none-match': state.etag } : {},
    });

    if (manifestRes.status === 304) {
      this.logger?.debug('IoC feed manifest unchanged (304)');
      return this.result('up_to_date', false, 0, 0, 0, state.syncedDate);
    }
    if (!manifestRes.ok) {
      throw new Error(`feed manifest fetch failed: HTTP ${manifestRes.status}`);
    }

    const etag = manifestRes.headers.get('etag');
    const manifest = parseManifest(await manifestRes.json());
    const plan = planSync(manifest, state.syncedDate);

    let result: SyncResult;
    switch (plan.mode) {
      case 'up_to_date':
        result = this.result('up_to_date', false, 0, 0, 0, manifest.latest_date);
        break;
      case 'full':
        result = await this.applyFull(manifest, plan);
        break;
      case 'delta':
        result = await this.applyDeltas(plan.deltas, 0, false);
        break;
    }

    this.feedState.set({
      syncedDate: result.syncedDate,
      etag: etag ?? state.etag,
      lastSyncAt: this.now().toISOString(),
    });
    this.logger?.info(
      { mode: result.mode, added: result.added, removed: result.removed, count: result.count },
      'IoC feed synced',
    );
    return result;
  }

  private async applyFull(
    manifest: FeedManifest,
    plan: Extract<SyncPlan, { mode: 'full' }>,
  ): Promise<SyncResult> {
    const body = await this.fetchVerified(plan.full.url, plan.full.sha256, 'full snapshot');
    const snapshot = parseSnapshot(JSON.parse(body));
    this.iocs.replaceAll(snapshot.entries);
    const base: SyncResult = this.result(
      'full',
      true,
      0,
      snapshot.entries.length,
      0,
      snapshot.date,
    );
    // Layer any deltas newer than the snapshot baseline.
    return this.applyDeltas(plan.thenDeltas, snapshot.entries.length, true, base.syncedDate);
  }

  private async applyDeltas(
    deltas: ReadonlyArray<FeedDeltaRef>,
    addedSoFar: number,
    fullDownloaded: boolean,
    startDate: string | null = this.feedState.get().syncedDate,
  ): Promise<SyncResult> {
    let added = addedSoFar;
    let removed = 0;
    let syncedDate = startDate;
    for (const ref of deltas) {
      const body = await this.fetchVerified(ref.url, ref.sha256, `delta ${ref.date}`);
      const delta = parseDelta(JSON.parse(body));
      this.iocs.upsert(delta.added);
      this.iocs.remove(delta.removed);
      added += delta.added.length;
      removed += delta.removed.length;
      syncedDate = delta.date;
    }
    const mode: SyncMode = fullDownloaded ? 'full' : 'delta';
    return this.result(mode, fullDownloaded, deltas.length, added, removed, syncedDate);
  }

  /** Fetch a body and assert its SHA-256 matches the manifest's ref. */
  private async fetchVerified(url: string, expectedSha: string, what: string): Promise<string> {
    const res = await this.doFetch(url);
    if (!res.ok) throw new Error(`${what} fetch failed: HTTP ${res.status}`);
    const body = await res.text();
    const actual = sha256Hex(body);
    if (actual !== expectedSha) {
      throw new Error(`${what} integrity check failed: sha256 ${actual} != ${expectedSha}`);
    }
    return body;
  }

  private result(
    mode: SyncMode,
    fullDownloaded: boolean,
    deltasApplied: number,
    added: number,
    removed: number,
    syncedDate: string | null,
  ): SyncResult {
    return {
      mode,
      fullDownloaded,
      deltasApplied,
      added,
      removed,
      count: this.iocs.count(),
      syncedDate,
    };
  }
}
