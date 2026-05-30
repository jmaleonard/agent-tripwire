import type { IoCDelta, IoCEntry, IoCRemoval } from '@tripwire/shared';

export const FEED_VERSION = 1;

/** Stable identity key for an IoC entry: `(ecosystem, package, version_spec)`. */
export function iocKey(e: {
  ecosystem: string;
  package: string;
  version_spec: string;
}): string {
  return `${e.ecosystem}\0${e.package}\0${e.version_spec}`;
}

/**
 * The fields a client actually stores. Two entries with the same key but
 * differing here represent a *changed* IoC and belong in a delta's `added`
 * (upsert reconciles them). `id` is local-only and ignored.
 */
function fingerprint(e: IoCEntry): string {
  return JSON.stringify({
    s: e.sources,
    c: e.campaign ?? null,
    f: e.first_seen,
    l: e.last_seen,
  });
}

export interface ComputeDeltaOptions {
  baseDate: string;
  date: string;
  generatedAt: string;
}

/**
 * Diff two snapshots into an {@link IoCDelta}. `added` holds entries that are
 * new or changed since `prev`; `removed` holds identity tuples present in
 * `prev` but gone from `next`. Order-independent; keyed on
 * `(ecosystem, package, version_spec)`.
 */
export function computeDelta(
  prev: ReadonlyArray<IoCEntry>,
  next: ReadonlyArray<IoCEntry>,
  opts: ComputeDeltaOptions,
): IoCDelta {
  const prevMap = new Map<string, IoCEntry>();
  for (const e of prev) prevMap.set(iocKey(e), e);

  const added: IoCEntry[] = [];
  const nextKeys = new Set<string>();
  for (const e of next) {
    const key = iocKey(e);
    nextKeys.add(key);
    const before = prevMap.get(key);
    if (before === undefined || fingerprint(before) !== fingerprint(e)) {
      added.push(e);
    }
  }

  const removed: IoCRemoval[] = [];
  for (const e of prev) {
    if (!nextKeys.has(iocKey(e))) {
      removed.push({
        ecosystem: e.ecosystem,
        package: e.package,
        version_spec: e.version_spec,
      });
    }
  }

  return {
    feed_version: FEED_VERSION,
    base_date: opts.baseDate,
    date: opts.date,
    generated_at: opts.generatedAt,
    added,
    removed,
  };
}
