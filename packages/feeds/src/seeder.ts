import type { IoCEntry } from '@tripwire/shared';
import { mergeFeeds } from './merger.js';
import type { FeedSource, RefreshOptions } from './source.js';

export interface SourceStat {
  id: string;
  count: number;
  ok: boolean;
  error?: string;
}

export interface SeederResult {
  entries: IoCEntry[];
  sourceStats: SourceStat[];
  generatedAt: string;
}

/**
 * Run every source, collect entries, merge. A failing source is recorded in
 * sourceStats but does not abort the run — per spec §5.2, when one feed
 * fails the rest still produce usable signal.
 */
export async function runSeeder(
  sources: ReadonlyArray<FeedSource>,
  opts: RefreshOptions = {},
): Promise<SeederResult> {
  const collected: IoCEntry[] = [];
  const sourceStats: SourceStat[] = [];

  for (const source of sources) {
    let count = 0;
    try {
      for await (const entry of source.refresh(opts)) {
        collected.push(entry);
        count++;
      }
      sourceStats.push({ id: source.id, count, ok: true });
    } catch (err) {
      sourceStats.push({
        id: source.id,
        count,
        ok: false,
        error: (err as Error).message,
      });
    }
  }

  return {
    entries: mergeFeeds(collected),
    sourceStats,
    generatedAt: new Date().toISOString(),
  };
}
