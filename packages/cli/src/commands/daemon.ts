import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Daemon } from '@tripwire/daemon';
import { ApiClient } from '../api.js';
import { cliPaths } from '../config.js';
import { c } from '../format.js';

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
  const portFlag = args.indexOf('--port');
  const port = portFlag !== -1 && args[portFlag + 1] ? Number(args[portFlag + 1]) : 7878;

  // Watcher is created by Daemon via createPlatformWatcher() — picks up the
  // Rust tripwire-watcher helper when present, falls back to MockFsWatcher.
  // IoC feed sync is enabled here (off by default in tests). TRIPWIRE_FEED_URL
  // overrides the manifest location, TRIPWIRE_NO_FEED_SYNC disables it.
  const daemon = await Daemon.start({
    dbPath,
    dashboardPort: port,
    iocSync: {
      enabled: process.env.TRIPWIRE_NO_FEED_SYNC !== '1',
      ...(process.env.TRIPWIRE_FEED_URL ? { manifestUrl: process.env.TRIPWIRE_FEED_URL } : {}),
    },
  });

  process.stdout.write(`${c.green}tripwired running${c.reset}\n`);
  process.stdout.write(`  db:         ${dbPath}\n`);
  process.stdout.write(`  dashboard:  http://127.0.0.1:${port}\n`);
  process.stdout.write(`  pid:        ${process.pid}\n`);
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
  const api = new ApiClient();
  if (await api.isReachable()) {
    process.stdout.write(`${c.green}● tripwired is running${c.reset}\n`);
    process.stdout.write(`  dashboard: ${process.env.TRIPWIRE_URL ?? 'http://127.0.0.1:7878'}\n`);
    return 0;
  }
  process.stdout.write(`${c.red}● tripwired is not running${c.reset}\n`);
  process.stdout.write(`  Start it with: tripwire daemon run\n`);
  return 1;
}
