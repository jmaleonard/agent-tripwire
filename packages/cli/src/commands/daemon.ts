import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Daemon } from '@tripwire/daemon';
import { computeSummary } from '@tripwire/store';
import { cliPaths } from '../config.js';
import { c } from '../format.js';
import { DbNotFoundError, reportNoStore, withStore } from '../store.js';

export async function daemonCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? 'run';
  switch (sub) {
    case 'run':
      return runDaemon(args.slice(1));
    case 'status':
      return daemonStatus();
    default:
      process.stderr.write(`Unknown daemon subcommand: ${sub}\nUsage: tripwire daemon [run|status]\n`);
      return 1;
  }
}

async function runDaemon(args: string[]): Promise<number> {
  const paths = cliPaths();
  mkdirSync(dirname(paths.dbPath), { recursive: true });

  const dbFlag = args.indexOf('--db');
  const dbPath = dbFlag !== -1 && args[dbFlag + 1] ? args[dbFlag + 1]! : paths.dbPath;

  // Watcher is created by Daemon via createPlatformWatcher() — picks up the
  // Rust tripwire-watcher helper when present, falls back to MockFsWatcher.
  // IoC feed sync is enabled here (off by default in tests). TRIPWIRE_FEED_URL
  // overrides the manifest location, TRIPWIRE_NO_FEED_SYNC disables it.
  const daemon = await Daemon.start({
    dbPath,
    iocSync: {
      enabled: process.env.TRIPWIRE_NO_FEED_SYNC !== '1',
      ...(process.env.TRIPWIRE_FEED_URL ? { manifestUrl: process.env.TRIPWIRE_FEED_URL } : {}),
    },
  });

  process.stdout.write(`${c.green}tripwired running${c.reset}\n`);
  process.stdout.write(`  db:       ${dbPath}\n`);
  process.stdout.write(`  pid:      ${process.pid}\n`);
  process.stdout.write(`  inspect:  ${c.cyan}tripwire tui${c.reset}  ${c.dim}(or tripwire status)${c.reset}\n`);
  process.stdout.write(`  ${c.dim}Press Ctrl-C to stop (or send SIGTERM).${c.reset}\n`);

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`\n${c.dim}got ${signal}, stopping…${c.reset}\n`);
    await daemon.stop();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Block forever.
  return new Promise<number>(() => {});
}

async function daemonStatus(): Promise<number> {
  try {
    return await withStore(repos => {
      const summary = computeSummary(repos);
      if (summary.daemon.running) {
        process.stdout.write(`${c.green}● tripwired is running${c.reset}\n`);
        process.stdout.write(`  ${c.dim}last heartbeat ${summary.daemon.last_heartbeat}${c.reset}\n`);
        return 0;
      }
      process.stdout.write(`${c.red}● tripwired is not running${c.reset}\n`);
      process.stdout.write(`  Start it with: brew services start tripwire  (or tripwire daemon run)\n`);
      return 1;
    });
  } catch (err) {
    if (err instanceof DbNotFoundError) return reportNoStore();
    throw err;
  }
}
