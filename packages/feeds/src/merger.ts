import type { IoCEntry, IoCSource } from '@tripwire/shared';

/**
 * Merge IoC entries from multiple sources by `(ecosystem, package, version_spec)`.
 * Per spec §5.1 / §5.2: deduplicate, union the `sources` arrays with per-source
 * attribution, keep earliest `first_seen` and latest `last_seen`, preserve a
 * non-empty campaign if any source carries one.
 */
export function mergeFeeds(entries: Iterable<IoCEntry>): IoCEntry[] {
  const map = new Map<string, IoCEntry>();
  for (const incoming of entries) {
    const key = `${incoming.ecosystem}\0${incoming.package}\0${incoming.version_spec}`;
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, { ...incoming, sources: [...incoming.sources] });
      continue;
    }
    mergeInto(existing, incoming);
  }
  return [...map.values()];
}

function mergeInto(existing: IoCEntry, incoming: IoCEntry): void {
  for (const src of incoming.sources) {
    if (!hasSource(existing.sources, src)) {
      existing.sources.push(src);
    }
  }
  if (incoming.first_seen < existing.first_seen) {
    existing.first_seen = incoming.first_seen;
  }
  if (incoming.last_seen > existing.last_seen) {
    existing.last_seen = incoming.last_seen;
  }
  if (existing.campaign === undefined && incoming.campaign !== undefined) {
    existing.campaign = incoming.campaign;
  }
}

function hasSource(haystack: readonly IoCSource[], needle: IoCSource): boolean {
  return haystack.some(s => s.name === needle.name);
}
