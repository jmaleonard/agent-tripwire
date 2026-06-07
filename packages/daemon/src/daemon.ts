import { createLogger, type Logger, type Rule, type Severity } from '@tripwire/shared';
import { Engine } from '@tripwire/engine';
import {
  DEFAULT_CLASSIFIER_CONFIG,
  DEFAULT_IDENTITY_ENV_KEYS,
  type ClassifierConfig,
  type ProcessReader,
} from '@tripwire/identity';
import { createNotifier, type Notifier } from '@tripwire/notifier';
import {
  AllowlistRepository,
  closeDb,
  EventRepository,
  FeedStateRepository,
  IoCRepository,
  MetaRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import { type FsEvent, type FsWatcher } from '@tripwire/watcher';
import type { TripwireEvent } from '@tripwire/shared';
import { defaultWatchPaths } from './default-paths.js';
import { DEFAULT_RULES } from './default-rules.js';
import { IoCSyncService, type SyncResult } from './ioc-sync.js';
import { handleFsEvent, type PipelineDeps } from './pipeline.js';
import { createPlatformReader, createPlatformWatcher } from './platform.js';

/** How often the daemon re-syncs the IoC feed once running. */
const DEFAULT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * How often the daemon writes its liveness heartbeat. Must be comfortably under
 * the store's DEFAULT_HEARTBEAT_STALE_MS (90s) so readers see it as alive.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30s

export interface IoCSyncConfig {
  /** Enable periodic IoC feed sync. Default false (tests/offline). */
  enabled?: boolean;
  /** Manifest URL override. Defaults to the public tripwire-feed repo. */
  manifestUrl?: string;
  /** Re-sync interval in ms. Default 6h. Set 0 to disable the timer (sync once on start). */
  intervalMs?: number;
  /** Injectable fetch (tests). */
  fetch?: typeof fetch;
}

export interface DaemonOptions {
  dbPath?: string;
  /** Watcher to use. Defaults to createPlatformWatcher() (NativeFsWatcher if the helper is on disk, MockFsWatcher otherwise). */
  watcher?: FsWatcher;
  processReader?: ProcessReader;
  rules?: ReadonlyArray<Rule>;
  notifier?: Notifier;
  classifierConfig?: ClassifierConfig;
  identityEnvKeys?: ReadonlySet<string>;
  minSeverity?: Severity;
  /** Path overrides for the watcher; defaults from spec §6.13. */
  readPaths?: ReadonlyArray<string>;
  writePaths?: ReadonlyArray<string>;
  /** IoC feed sync config. Disabled by default; the CLI `daemon run` enables it. */
  iocSync?: IoCSyncConfig;
  /** Liveness heartbeat interval in ms. Default 30s. Set 0 to write once on start (tests). */
  heartbeatIntervalMs?: number;
  /** Override the path-match home (mostly for tests). */
  home?: string;
  /** Override the clock. */
  now?: () => Date;
  /** Override the logger. */
  logger?: Logger;
}

/**
 * The thing that gets installed as a launchd / systemd user unit. Wires
 * watcher → identify → engine → store → notifier. There is no network surface:
 * the CLI, TUI, and menu-bar app all read the same SQLite store directly, and
 * the daemon publishes a liveness heartbeat into it. Lifecycle is start() /
 * stop(); stop() awaits inflight pipeline work before tearing repos down.
 */
export class Daemon {
  private readonly opts: DaemonOptions;
  private readonly logger: Logger;
  private db!: DbHandle;
  private engine!: Engine;
  private notifier!: Notifier;
  private processReader!: ProcessReader;
  events!: EventRepository;
  snoozes!: SnoozeRepository;
  allowlist!: AllowlistRepository;
  iocs!: IoCRepository;
  feedState!: FeedStateRepository;
  meta!: MetaRepository;
  private iocSync: IoCSyncService | undefined;
  private syncTimer: ReturnType<typeof setInterval> | undefined;
  private syncTask: Promise<unknown> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private activeWatcher: FsWatcher | undefined;
  private watcherOff: (() => void) | undefined;
  private watcherErrOff: (() => void) | undefined;
  private inflight = new Set<Promise<unknown>>();
  private started = false;

  constructor(opts: DaemonOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? createLogger({ name: 'tripwired' });
  }

  static async start(opts: DaemonOptions): Promise<Daemon> {
    const d = new Daemon(opts);
    await d.initialize();
    return d;
  }

  private now(): Date {
    return (this.opts.now ?? (() => new Date()))();
  }

  private async initialize(): Promise<void> {
    if (this.started) throw new Error('Daemon already started');
    this.db = openDb({ path: this.opts.dbPath ?? ':memory:' });
    this.events = new EventRepository(this.db);
    this.snoozes = new SnoozeRepository(this.db);
    this.allowlist = new AllowlistRepository(this.db);
    this.iocs = new IoCRepository(this.db);
    this.feedState = new FeedStateRepository(this.db);
    this.meta = new MetaRepository(this.db);

    if (this.opts.iocSync?.enabled) {
      this.iocSync = new IoCSyncService({
        iocs: this.iocs,
        feedState: this.feedState,
        logger: this.logger,
        ...(this.opts.iocSync.manifestUrl !== undefined
          ? { manifestUrl: this.opts.iocSync.manifestUrl }
          : {}),
        ...(this.opts.iocSync.fetch !== undefined ? { fetch: this.opts.iocSync.fetch } : {}),
        ...(this.opts.now !== undefined ? { now: this.opts.now } : {}),
      });
    }

    this.engine = new Engine({
      rules: this.opts.rules ?? DEFAULT_RULES,
      allowlist: this.allowlist,
      snoozes: this.snoozes,
      iocs: this.iocs,
    });

    this.processReader = this.opts.processReader ?? createPlatformReader();
    this.notifier = this.opts.notifier ?? createNotifier();

    const watcher = this.opts.watcher ?? createPlatformWatcher(this.logger);
    this.activeWatcher = watcher;
    this.watcherOff = watcher.onEvent(fsEvent => {
      const task = this.runPipeline(fsEvent);
      this.inflight.add(task);
      void task.finally(() => this.inflight.delete(task));
    });
    this.watcherErrOff = watcher.onError(err => {
      this.logger.error({ err }, 'watcher reported an error');
    });

    const { read_paths, write_paths } = defaultWatchPaths();
    await watcher.start({
      read_paths: this.opts.readPaths ?? read_paths,
      write_paths: this.opts.writePaths ?? write_paths,
    });

    this.started = true;
    this.logger.info('tripwired started');

    this.startHeartbeat();
    this.startIocSync();
  }

  /** Write a liveness heartbeat now and on a timer, so readers know we're up. */
  private startHeartbeat(): void {
    const beat = (): void => this.meta.recordHeartbeat(this.now());
    beat();
    const interval = this.opts.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    if (interval > 0) {
      // Intentionally NOT unref'd: this ref'd timer is what keeps the process
      // alive for `tripwire daemon run`. Without the old HTTP server's listening
      // socket, a MockFsWatcher (no native helper installed) would otherwise let
      // the event loop drain and the daemon exit. stop() clears it.
      this.heartbeatTimer = setInterval(beat, interval);
    }
  }

  /** Kick an initial IoC feed sync (non-blocking) and schedule periodic refresh. */
  private startIocSync(): void {
    if (!this.iocSync) return;
    const run = (): void => {
      // Track the latest run so stop() can await it before closing the DB.
      this.syncTask = this.syncIocs().catch(err =>
        this.logger.warn({ err }, 'IoC feed sync failed'),
      );
    };
    run();
    const interval = this.opts.iocSync?.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
    if (interval > 0) {
      this.syncTimer = setInterval(run, interval);
      this.syncTimer.unref?.();
    }
  }

  /**
   * Pull the IoC feed into the local store. Exposed for the `tripwire ioc sync`
   * CLI command path. Throws if feed sync is not configured.
   */
  async syncIocs(): Promise<SyncResult> {
    if (!this.iocSync) throw new Error('IoC feed sync is not enabled');
    return this.iocSync.sync();
  }

  /**
   * Public test hook: run a synthetic FsEvent through the daemon's full
   * pipeline. Returns the TripwireEvents that fired. The same inflight tracking
   * applies, so waitIdle() / stop() block on test events too.
   */
  async testEvent(fsEvent: FsEvent): Promise<TripwireEvent[]> {
    let result: TripwireEvent[] = [];
    const task = this.runPipeline(fsEvent).then(events => {
      result = events;
    });
    this.inflight.add(task);
    try {
      await task;
    } finally {
      this.inflight.delete(task);
    }
    return result;
  }

  private async runPipeline(fsEvent: FsEvent): Promise<TripwireEvent[]> {
    const deps: PipelineDeps = {
      engine: this.engine,
      events: this.events,
      notifier: this.notifier,
      processReader: this.processReader,
      classifierConfig: this.opts.classifierConfig ?? DEFAULT_CLASSIFIER_CONFIG,
      identityEnvKeys: this.opts.identityEnvKeys ?? DEFAULT_IDENTITY_ENV_KEYS,
      logger: this.logger,
      ...(this.opts.minSeverity !== undefined ? { minSeverity: this.opts.minSeverity } : {}),
      ...(this.opts.home !== undefined ? { home: this.opts.home } : {}),
    };
    try {
      return await handleFsEvent(deps, fsEvent);
    } catch (err) {
      this.logger.error({ err, fsEvent }, 'pipeline failed');
      return [];
    }
  }

  /** Awaits every inflight pipeline turn. Used by tests + graceful shutdown. */
  async waitIdle(): Promise<void> {
    while (this.inflight.size > 0) {
      await Promise.allSettled([...this.inflight]);
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.watcherOff?.();
    this.watcherErrOff?.();
    await this.waitIdle();
    // Let an in-flight feed sync finish before the DB closes under it.
    if (this.syncTask) await this.syncTask.catch(() => {});
    if (this.activeWatcher) await this.activeWatcher.stop();
    closeDb(this.db);
    this.started = false;
  }
}
