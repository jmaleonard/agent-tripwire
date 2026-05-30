import { createLogger, type Logger, type Rule, type Severity } from '@tripwire/shared';
import { Engine } from '@tripwire/engine';
import { startDashboard, type RunningDashboard } from '@tripwire/dashboard';
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
  /** Start the dashboard HTTP server? Default true. */
  startDashboardServer?: boolean;
  dashboardPort?: number;
  dashboardHost?: string;
  /** Override the path-match home (mostly for tests). */
  home?: string;
  /** Override the clock. */
  now?: () => Date;
  /** Override the logger. */
  logger?: Logger;
}

/**
 * The thing that gets installed as a launchd / systemd user unit. Wires
 * watcher → identify → engine → store → notifier, plus the dashboard HTTP
 * server. Lifecycle is start() / stop(). For graceful shutdown, stop()
 * awaits inflight pipeline work before tearing repos down.
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
  private iocSync: IoCSyncService | undefined;
  private syncTimer: ReturnType<typeof setInterval> | undefined;
  private dashboard: RunningDashboard | undefined;
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

  private async initialize(): Promise<void> {
    if (this.started) throw new Error('Daemon already started');
    this.db = openDb({ path: this.opts.dbPath ?? ':memory:' });
    this.events = new EventRepository(this.db);
    this.snoozes = new SnoozeRepository(this.db);
    this.allowlist = new AllowlistRepository(this.db);
    this.iocs = new IoCRepository(this.db);
    this.feedState = new FeedStateRepository(this.db);

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

    if (this.opts.startDashboardServer !== false) {
      this.dashboard = startDashboard(
        {
          events: this.events,
          snoozes: this.snoozes,
          allowlist: this.allowlist,
          iocs: this.iocs,
          feedState: this.feedState,
          ...(this.opts.now !== undefined ? { now: this.opts.now } : {}),
          // Plumb the test-event hook so POST /api/test-event runs through
          // the full pipeline (identify → engine → store → notify).
          onTestEvent: fsEvent => this.testEvent(fsEvent),
          // POST /api/iocs/sync triggers a feed pull (503 when sync disabled).
          ...(this.iocSync !== undefined ? { onSyncIocs: () => this.syncIocs() } : {}),
        },
        {
          port: this.opts.dashboardPort ?? 7878,
          hostname: this.opts.dashboardHost ?? '127.0.0.1',
        },
      );
    }

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
    this.logger.info(
      { dashboard: this.dashboard !== undefined, port: this.opts.dashboardPort ?? 7878 },
      'tripwired started',
    );

    this.startIocSync();
  }

  /** Kick an initial IoC feed sync (non-blocking) and schedule periodic refresh. */
  private startIocSync(): void {
    if (!this.iocSync) return;
    const run = (): void => {
      void this.syncIocs().catch(err =>
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
   * Pull the IoC feed into the local store. Exposed for the dashboard
   * `POST /api/iocs/sync` endpoint and the `tripwire ioc sync` CLI command.
   * Throws if feed sync is not configured.
   */
  async syncIocs(): Promise<SyncResult> {
    if (!this.iocSync) throw new Error('IoC feed sync is not enabled');
    return this.iocSync.sync();
  }

  /**
   * Public test hook: run a synthetic FsEvent through the daemon's full
   * pipeline. Returns the TripwireEvents that fired so the caller (CLI,
   * dashboard endpoint) can show the result. The same inflight tracking
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
      ...(this.dashboardUrl !== undefined ? { dashboardUrl: this.dashboardUrl } : {}),
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
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.watcherOff?.();
    this.watcherErrOff?.();
    await this.waitIdle();
    if (this.activeWatcher) await this.activeWatcher.stop();
    if (this.dashboard) await this.dashboard.close();
    closeDb(this.db);
    this.started = false;
  }

  /** http://<host>:<port> used for notification click-to-open. */
  private get dashboardUrl(): string | undefined {
    if (!this.dashboard) return undefined;
    const host = this.opts.dashboardHost ?? '127.0.0.1';
    const port = this.opts.dashboardPort ?? 7878;
    return `http://${host}:${port}`;
  }
}
