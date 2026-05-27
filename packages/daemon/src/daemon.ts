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
  IoCRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import { type FsEvent, type FsWatcher } from '@tripwire/watcher';
import type { TripwireEvent } from '@tripwire/shared';
import { defaultWatchPaths } from './default-paths.js';
import { DEFAULT_RULES } from './default-rules.js';
import { handleFsEvent, type PipelineDeps } from './pipeline.js';
import { createPlatformReader, createPlatformWatcher } from './platform.js';

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
          ...(this.opts.now !== undefined ? { now: this.opts.now } : {}),
          // Plumb the test-event hook so POST /api/test-event runs through
          // the full pipeline (identify → engine → store → notify).
          onTestEvent: fsEvent => this.testEvent(fsEvent),
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
