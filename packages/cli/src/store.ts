import { existsSync } from 'node:fs';
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
import { cliPaths } from './config.js';
import { c } from './format.js';

/** Thrown by {@link openCliDb} when the store doesn't exist yet. */
export class DbNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`tripwire store not found at ${path}`);
    this.name = 'DbNotFoundError';
  }
}

export interface CliRepos {
  db: DbHandle;
  events: EventRepository;
  snoozes: SnoozeRepository;
  allowlist: AllowlistRepository;
  iocs: IoCRepository;
  feedState: FeedStateRepository;
  meta: MetaRepository;
}

/**
 * Open the user's events.db read-write (so migrations are current and write
 * commands work). Throws {@link DbNotFoundError} if the store was never created
 * — we don't silently conjure an empty DB; the user should run `tripwire setup`.
 *
 * The daemon may hold the same DB open; SQLite WAL + busy_timeout (set in
 * @tripwire/store) makes concurrent access from the CLI safe.
 */
export function openCliDb(): DbHandle {
  const { dbPath } = cliPaths();
  if (!existsSync(dbPath)) throw new DbNotFoundError(dbPath);
  return openDb({ path: dbPath });
}

/** Open the store, build repositories, run `fn`, and always close the DB. */
export async function withStore<T>(fn: (repos: CliRepos) => T | Promise<T>): Promise<T> {
  const db = openCliDb();
  try {
    return await fn({
      db,
      events: new EventRepository(db),
      snoozes: new SnoozeRepository(db),
      allowlist: new AllowlistRepository(db),
      iocs: new IoCRepository(db),
      feedState: new FeedStateRepository(db),
      meta: new MetaRepository(db),
    });
  } finally {
    closeDb(db);
  }
}

/** Print the standard "no store yet" hint and return exit code 2. */
export function reportNoStore(): number {
  process.stderr.write(
    `${c.red}No tripwire store yet.${c.reset} Run ${c.cyan}tripwire setup${c.reset} first.\n`,
  );
  return 2;
}
