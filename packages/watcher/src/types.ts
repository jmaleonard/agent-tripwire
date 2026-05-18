import type { EventKind } from '@tripwire/shared';

/**
 * A filesystem event the kernel told us about. Normalized across platforms.
 *
 * `pid` is null when the platform can't report it — e.g. macOS reads, which
 * require the Endpoint Security entitlement we don't have. The engine treats
 * pid=null events as low-confidence and may not classify them.
 */
export interface FsEvent {
  /** ISO-8601 timestamp of when the kernel reported the event. */
  timestamp: string;
  /** Absolute path that was touched. */
  path: string;
  /** Normalized event kind. */
  kind: EventKind;
  /** PID of the process that caused the event, or null when unknown. */
  pid: number | null;
}

export interface FsWatchOptions {
  /** Paths to watch for read events. */
  read_paths: ReadonlyArray<string>;
  /** Paths to watch for write/create/unlink/rename events. */
  write_paths: ReadonlyArray<string>;
  /** When this fires, the watcher gracefully stops. */
  signal?: AbortSignal;
}

export type FsEventListener = (event: FsEvent) => void;
export type FsErrorListener = (err: Error) => void;

/**
 * The contract every concrete watcher implements. Phase 1 ships MockFsWatcher
 * for tests + dev; real implementations (fanotify helper, fsevents) plug into
 * the same interface in follow-up PRs.
 */
export interface FsWatcher {
  /** Arm the underlying kernel mechanism. Resolves once paths are watched. */
  start(opts: FsWatchOptions): Promise<void>;
  /** Tear down. Idempotent; calling on an already-stopped watcher is a noop. */
  stop(): Promise<void>;
  /** Subscribe to events. Returns a disposer that removes the listener. */
  onEvent(listener: FsEventListener): () => void;
  /** Subscribe to errors (e.g. dropped events, helper-process crashes). */
  onError(listener: FsErrorListener): () => void;
}
