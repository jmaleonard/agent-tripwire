import { ApiClient } from '../api.js';
import { c, renderTable } from '../format.js';

interface Entry {
  ecosystem: string;
  package: string;
  version_spec: string;
  sources: Array<{ name: string }>;
  campaign?: string;
  first_seen: string;
  last_seen: string;
}

interface SyncResult {
  mode: string;
  added: number;
  removed: number;
  count: number;
  syncedDate?: string | null;
}

export async function iocCommand(args: string[]): Promise<number> {
  const api = new ApiClient();

  if (args[0] === 'sync') {
    return iocSync(api);
  }

  if (args.length === 0) {
    const { count } = await api.get<{ count: number }>('/api/iocs');
    process.stdout.write(`${c.bold}${count}${c.reset} IoC entries in the local DB.\n`);
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
  const params = new URLSearchParams({ ecosystem, package: pkg });
  const { entries } = await api.get<{ entries: Entry[] }>(`/api/iocs?${params.toString()}`);
  if (entries.length === 0) {
    process.stdout.write(`${c.dim}No IoC entries for ${ecosystem}:${pkg}.${c.reset}\n`);
    return 0;
  }
  process.stdout.write(
    renderTable(
      [
        { label: 'VERSION' },
        { label: 'SOURCES' },
        { label: 'CAMPAIGN' },
        { label: 'LAST_SEEN' },
      ],
      entries.map(e => [
        e.version_spec,
        e.sources.map(s => s.name).join(', '),
        e.campaign ?? '—',
        e.last_seen,
      ]),
    ) + '\n',
  );
  return 0;
}

async function iocSync(api: ApiClient): Promise<number> {
  process.stdout.write(`${c.dim}Syncing IoC feed…${c.reset}\n`);
  try {
    const r = await api.post<SyncResult>('/api/iocs/sync', {});
    const detail =
      r.mode === 'up_to_date'
        ? 'already up to date'
        : `${r.mode}: +${r.added} −${r.removed}`;
    process.stdout.write(
      `${c.green}✓${c.reset} ${detail} (${c.bold}${r.count}${c.reset} IoCs` +
        `${r.syncedDate ? `, current as of ${r.syncedDate}` : ''})\n`,
    );
    return 0;
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('503')) {
      process.stderr.write(`${c.red}IoC feed sync is disabled on the daemon.${c.reset}\n`);
    } else {
      process.stderr.write(`${c.red}Sync failed:${c.reset} ${msg}\n`);
    }
    return 1;
  }
}
