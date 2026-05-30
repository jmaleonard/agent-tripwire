import { createHash } from 'node:crypto';
import type {
  FeedDeltaRef,
  FeedFullRef,
  FeedManifest,
  IoCDelta,
  IoCSnapshot,
} from '@tripwire/shared';
import { FEED_VERSION } from './delta.js';

/** Hex SHA-256 of a string body — used for manifest integrity refs. */
export function sha256Hex(body: string): string {
  return createHash('sha256').update(body, 'utf-8').digest('hex');
}

export interface BuildManifestInput {
  generatedAt: string;
  full: FeedFullRef;
  /** Full delta chain available on top of `full`, oldest→newest. */
  deltas: FeedDeltaRef[];
}

export function buildManifest(input: BuildManifestInput): FeedManifest {
  const deltas = [...input.deltas].sort((a, b) => a.date.localeCompare(b.date));
  const latest_date = deltas.length > 0 ? deltas[deltas.length - 1]!.date : input.full.date;
  return {
    feed_version: FEED_VERSION,
    generated_at: input.generatedAt,
    latest_date,
    full: input.full,
    deltas,
  };
}

// ---- Parsing / validation -------------------------------------------------

class FeedParseError extends Error {}

function asObject(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null) {
    throw new FeedParseError(`${what}: expected object`);
  }
  return v as Record<string, unknown>;
}

function asString(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new FeedParseError(`${what}: expected string`);
  return v;
}

function asNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new FeedParseError(`${what}: expected number`);
  }
  return v;
}

function asArray(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new FeedParseError(`${what}: expected array`);
  return v;
}

export function parseManifest(json: unknown): FeedManifest {
  const o = asObject(json, 'manifest');
  const version = asNumber(o.feed_version, 'manifest.feed_version');
  if (version !== FEED_VERSION) {
    throw new FeedParseError(
      `manifest.feed_version ${version} unsupported (client expects ${FEED_VERSION})`,
    );
  }
  const fullObj = asObject(o.full, 'manifest.full');
  const full: FeedFullRef = {
    date: asString(fullObj.date, 'manifest.full.date'),
    url: asString(fullObj.url, 'manifest.full.url'),
    sha256: asString(fullObj.sha256, 'manifest.full.sha256'),
    count: asNumber(fullObj.count, 'manifest.full.count'),
    bytes: asNumber(fullObj.bytes, 'manifest.full.bytes'),
  };
  const deltas = asArray(o.deltas, 'manifest.deltas').map((d, i): FeedDeltaRef => {
    const dObj = asObject(d, `manifest.deltas[${i}]`);
    return {
      date: asString(dObj.date, `manifest.deltas[${i}].date`),
      base_date: asString(dObj.base_date, `manifest.deltas[${i}].base_date`),
      url: asString(dObj.url, `manifest.deltas[${i}].url`),
      sha256: asString(dObj.sha256, `manifest.deltas[${i}].sha256`),
      added: asNumber(dObj.added, `manifest.deltas[${i}].added`),
      removed: asNumber(dObj.removed, `manifest.deltas[${i}].removed`),
    };
  });
  return {
    feed_version: version,
    generated_at: asString(o.generated_at, 'manifest.generated_at'),
    latest_date: asString(o.latest_date, 'manifest.latest_date'),
    full,
    deltas,
  };
}

export function parseSnapshot(json: unknown): IoCSnapshot {
  const o = asObject(json, 'snapshot');
  return {
    generated_at: asString(o.generated_at, 'snapshot.generated_at'),
    date: asString(o.date, 'snapshot.date'),
    entries: asArray(o.entries, 'snapshot.entries') as IoCSnapshot['entries'],
  };
}

export function parseDelta(json: unknown): IoCDelta {
  const o = asObject(json, 'delta');
  return {
    feed_version: asNumber(o.feed_version, 'delta.feed_version'),
    base_date: asString(o.base_date, 'delta.base_date'),
    date: asString(o.date, 'delta.date'),
    generated_at: asString(o.generated_at, 'delta.generated_at'),
    added: asArray(o.added, 'delta.added') as IoCDelta['added'],
    removed: asArray(o.removed, 'delta.removed') as IoCDelta['removed'],
  };
}

// ---- Sync planning --------------------------------------------------------

export type SyncPlan =
  | { mode: 'up_to_date' }
  | { mode: 'full'; full: FeedFullRef; thenDeltas: FeedDeltaRef[] }
  | { mode: 'delta'; deltas: FeedDeltaRef[] };

/**
 * Decide what a client at `syncedDate` must download to reach the manifest's
 * latest. The deltas form a chain among themselves (each `base_date` is the
 * previous delta's `date`); `full` is the fallback baseline for a client that
 * has fallen off the chain or has never synced. So: take just the deltas when
 * an unbroken chain bridges `syncedDate`→latest, otherwise download `full`
 * (plus any deltas layered past `full.date`).
 */
export function planSync(manifest: FeedManifest, syncedDate: string | null): SyncPlan {
  if (syncedDate !== null && syncedDate === manifest.latest_date) {
    return { mode: 'up_to_date' };
  }

  const deltasAfter = (date: string): FeedDeltaRef[] =>
    manifest.deltas.filter(d => d.date > date);

  // Can we walk an unbroken chain from syncedDate up to latest using deltas?
  if (syncedDate !== null) {
    const chain = deltasAfter(syncedDate);
    if (chainIsContiguous(chain, syncedDate, manifest.latest_date)) {
      return chain.length > 0 ? { mode: 'delta', deltas: chain } : { mode: 'up_to_date' };
    }
  }

  // Fall back to a full download, then any deltas layered on the baseline.
  return { mode: 'full', full: manifest.full, thenDeltas: deltasAfter(manifest.full.date) };
}

/** True if `chain` forms base→…→target with each delta's base_date matching. */
function chainIsContiguous(
  chain: FeedDeltaRef[],
  fromDate: string,
  targetDate: string,
): boolean {
  let cursor = fromDate;
  for (const d of chain) {
    if (d.base_date !== cursor) return false;
    cursor = d.date;
  }
  return cursor === targetDate;
}
