import { existsSync } from 'node:fs';
import type { Ecosystem } from '@tripwire/shared';
import { runIocSync } from '@tripwire/daemon';
import { cliPaths } from '../config.js';
import { c, renderTable } from '../format.js';
import { DbNotFoundError, reportNoStore, withStore } from '../store.js';

const VALID_ECOSYSTEMS = new Set<Ecosystem>(['npm', 'pypi', 'other']);

export async function iocCommand(args: string[]): Promise<number> {
  if (args[0] === 'sync') {
    return iocSync();
  }
  try {
    return await withStore(({ iocs }) => {
      if (args.length === 0) {
        process.stdout.write(`${c.bold}${iocs.count()}${c.reset} IoC entries in the local DB.\n`);
        process.stdout.write(
          `${c.dim}Usage: tripwire ioc sync | ioc [--ecosystem npm|pypi] <package>${c.reset}\n`,
        );
        return 0;
      }

      let ecosystem = 'npm';
      let pkg: string | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--ecosystem' && args[i + 1]) {
          ecosystem = args[i + 1]!;
          i++;
        } else {
          pkg = args[i];
        }
      }
      if (!pkg) {
        process.stderr.write('tripwire ioc <package>\n');
        return 1;
      }
      if (!VALID_ECOSYSTEMS.has(ecosystem as Ecosystem)) {
        process.stderr.write(`Invalid ecosystem: ${ecosystem} (npm | pypi | other)\n`);
        return 1;
      }

      const entries = iocs.lookup(ecosystem as Ecosystem, pkg);
      if (entries.length === 0) {
        process.stdout.write(`${c.dim}No IoC entries for ${ecosystem}:${pkg}.${c.reset}\n`);
        return 0;
      }
      process.stdout.write(
        renderTable(
          [{ label: 'VERSION' }, { label: 'SOURCES' }, { label: 'CAMPAIGN' }, { label: 'LAST_SEEN' }],
          entries.map(e => [
            e.version_spec,
            e.sources.map(s => s.name).join(', '),
            e.campaign ?? '—',
            e.last_seen,
          ]),
        ) + '\n',
      );
      return 0;
    });
  } catch (err) {
    if (err instanceof DbNotFoundError) return reportNoStore();
    throw err;
  }
}

async function iocSync(): Promise<number> {
  const { dbPath } = cliPaths();
  if (!existsSync(dbPath)) return reportNoStore();

  process.stdout.write(`${c.dim}Syncing IoC feed…${c.reset}\n`);
  try {
    const r = await runIocSync({
      dbPath,
      ...(process.env.TRIPWIRE_FEED_URL ? { manifestUrl: process.env.TRIPWIRE_FEED_URL } : {}),
    });
    const detail = r.mode === 'up_to_date' ? 'already up to date' : `${r.mode}: +${r.added} −${r.removed}`;
    process.stdout.write(
      `${c.green}✓${c.reset} ${detail} (${c.bold}${r.count}${c.reset} IoCs` +
        `${r.syncedDate ? `, current as of ${r.syncedDate}` : ''})\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`${c.red}Sync failed:${c.reset} ${(err as Error).message}\n`);
    return 1;
  }
}
