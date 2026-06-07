import { createLogger, type EventKind, type Logger, type Rule, type TripwireEvent } from '@tripwire/shared';
import { Engine } from '@tripwire/engine';
import {
  DEFAULT_CLASSIFIER_CONFIG,
  DEFAULT_IDENTITY_ENV_KEYS,
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
} from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';
import { DEFAULT_RULES } from './default-rules.js';
import { IoCSyncService, type SyncResult } from './ioc-sync.js';
import { handleFsEvent } from './pipeline.js';
import { createPlatformReader } from './platform.js';

export interface ExecuteTestEventOptions {
  dbPath: string;
  path: string;
  kind: EventKind;
  /**
   * PID of the synthetic firing process. Defaults to `null` → a synthetic
   * 'unknown'-category identity, so rules scoped `not_in: [human-shell]` fire
   * (the whole point of a test event). Pass a real PID to exercise ancestry.
   */
  pid?: number | null;
  rules?: ReadonlyArray<Rule>;
  notifier?: Notifier;
  processReader?: ProcessReader;
  home?: string;
  now?: () => Date;
  logger?: Logger;
}

/**
 * Run a single synthetic FsEvent through the full pipeline (identify → engine →
 * store → notify) against the on-disk store, without a running daemon. Backs
 * `tripwire test-event`. Returns the TripwireEvents that fired.
 */
export async function executeTestEvent(opts: ExecuteTestEventOptions): Promise<TripwireEvent[]> {
  const logger = opts.logger ?? createLogger({ name: 'tripwire-test-event', level: 'silent' });
  const db = openDb({ path: opts.dbPath });
  try {
    const engine = new Engine({
      rules: opts.rules ?? DEFAULT_RULES,
      allowlist: new AllowlistRepository(db),
      snoozes: new SnoozeRepository(db),
      iocs: new IoCRepository(db),
    });
    const fsEvent: FsEvent = {
      timestamp: (opts.now ?? (() => new Date()))().toISOString(),
      path: opts.path,
      kind: opts.kind,
      pid: opts.pid ?? null,
    };
    return await handleFsEvent(
      {
        engine,
        events: new EventRepository(db),
        notifier: opts.notifier ?? createNotifier(),
        processReader: opts.processReader ?? createPlatformReader(),
        classifierConfig: DEFAULT_CLASSIFIER_CONFIG,
        identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
        logger,
        ...(opts.home !== undefined ? { home: opts.home } : {}),
      },
      fsEvent,
    );
  } finally {
    closeDb(db);
  }
}

export interface RunIocSyncOptions {
  dbPath: string;
  manifestUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  logger?: Logger;
}

/**
 * Pull the published IoC feed into the on-disk store, without a running daemon.
 * Backs `tripwire ioc sync`. The daemon also syncs on its own schedule; both
 * write the same tables under WAL, so a manual run alongside a running daemon is
 * safe.
 */
export async function runIocSync(opts: RunIocSyncOptions): Promise<SyncResult> {
  const db = openDb({ path: opts.dbPath });
  try {
    const service = new IoCSyncService({
      iocs: new IoCRepository(db),
      feedState: new FeedStateRepository(db),
      ...(opts.manifestUrl !== undefined ? { manifestUrl: opts.manifestUrl } : {}),
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
      ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
      ...(opts.now !== undefined ? { now: opts.now } : {}),
    });
    return await service.sync();
  } finally {
    closeDb(db);
  }
}
