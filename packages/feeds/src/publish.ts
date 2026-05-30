import type {
  FeedDeltaRef,
  FeedManifest,
  IoCDelta,
  IoCEntry,
  IoCSnapshot,
} from '@tripwire/shared';
import { computeDelta } from './delta.js';
import { buildManifest, sha256Hex } from './manifest.js';

/** Default number of daily deltas to retain in the manifest / feed repo. */
export const DEFAULT_KEEP_DELTAS = 30;

export interface PlanPublishInput {
  /** Today's merged IoC entries (from runSeeder). */
  nextEntries: ReadonlyArray<IoCEntry>;
  /** Date being published (YYYY-MM-DD). */
  date: string;
  generatedAt: string;
  /** Entries from the previous `latest.json`, or [] on the first run. */
  prevEntries: ReadonlyArray<IoCEntry>;
  /** The previous manifest, or null on the first run. */
  prevManifest: FeedManifest | null;
  /** Stable URL the published `latest.json` release asset will live at. */
  fullUrl: string;
  /** Maps a delta date to the raw URL its committed file will live at. */
  deltaUrl: (date: string) => string;
  /** How many daily deltas to keep. Default {@link DEFAULT_KEEP_DELTAS}. */
  keepDeltas?: number;
}

export interface PublishPlan {
  snapshot: IoCSnapshot;
  /** Serialized snapshot — upload as the `latest.json` release asset. */
  snapshotBody: string;
  /** The day's delta, or null on the first run (nothing to diff against). */
  delta: IoCDelta | null;
  /** Serialized delta — commit as feed/v1/delta-<date>.json. */
  deltaBody: string | null;
  manifest: FeedManifest;
  /** Serialized manifest — commit as feed/v1/manifest.json. */
  manifestBody: string;
  /** Delta dates dropped by retention — their committed files can be deleted. */
  prunedDeltaDates: string[];
}

/**
 * Pure planner for a daily feed publish. Computes the day's snapshot + delta
 * (diffed against the previous `latest.json`), folds the delta into the
 * manifest's chain, and prunes the chain to `keepDeltas`. All IO (downloading
 * the previous snapshot, uploading the release asset, committing files) is the
 * caller's job — this is deterministic given its inputs.
 */
export function planPublish(input: PlanPublishInput): PublishPlan {
  const keep = input.keepDeltas ?? DEFAULT_KEEP_DELTAS;

  const snapshot: IoCSnapshot = {
    generated_at: input.generatedAt,
    date: input.date,
    entries: [...input.nextEntries],
  };
  const snapshotBody = JSON.stringify(snapshot);

  let delta: IoCDelta | null = null;
  let deltaBody: string | null = null;
  let newRef: FeedDeltaRef | null = null;

  // A delta only makes sense when there's a prior snapshot to diff against and
  // the date actually advanced.
  if (input.prevManifest !== null && input.prevManifest.latest_date !== input.date) {
    delta = computeDelta(input.prevEntries, input.nextEntries, {
      baseDate: input.prevManifest.latest_date,
      date: input.date,
      generatedAt: input.generatedAt,
    });
    deltaBody = JSON.stringify(delta);
    newRef = {
      date: input.date,
      base_date: input.prevManifest.latest_date,
      url: input.deltaUrl(input.date),
      sha256: sha256Hex(deltaBody),
      added: delta.added.length,
      removed: delta.removed.length,
    };
  }

  const priorRefs = input.prevManifest?.deltas ?? [];
  const allRefs = newRef ? [...priorRefs, newRef] : [...priorRefs];
  // Keep the newest `keep` by date; older ones (and their files) are pruned.
  const sorted = [...allRefs].sort((a, b) => a.date.localeCompare(b.date));
  const kept = sorted.slice(-keep);
  const keptDates = new Set(kept.map(d => d.date));
  const prunedDeltaDates = priorRefs.map(d => d.date).filter(d => !keptDates.has(d));

  const manifest = buildManifest({
    generatedAt: input.generatedAt,
    full: {
      date: input.date,
      url: input.fullUrl,
      sha256: sha256Hex(snapshotBody),
      count: snapshot.entries.length,
      bytes: Buffer.byteLength(snapshotBody, 'utf-8'),
    },
    deltas: kept,
  });

  return {
    snapshot,
    snapshotBody,
    delta,
    deltaBody,
    manifest,
    manifestBody: JSON.stringify(manifest),
    prunedDeltaDates,
  };
}
