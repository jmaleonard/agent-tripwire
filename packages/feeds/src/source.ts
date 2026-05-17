import type { IoCEntry } from '@tripwire/shared';

export interface RefreshOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

export interface FeedHealth {
  ok: boolean;
  message?: string;
  lastChecked: string;
}

/**
 * A pluggable IoC feed source (CONTRIBUTING.md "Adding an IoC feed source").
 * Implementations stream entries via an async iterable so large feeds (OSV
 * bulk, future GHSA git clone) can be processed without loading everything
 * into memory at once.
 */
export interface FeedSource {
  readonly id: string;
  refresh(opts?: RefreshOptions): AsyncIterable<IoCEntry>;
  healthCheck(): Promise<FeedHealth>;
}
