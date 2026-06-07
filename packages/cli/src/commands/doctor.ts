import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { computeSummary } from '@tripwire/store';
import { cliPaths } from '../config.js';
import { c } from '../format.js';
import { DbNotFoundError, withStore } from '../store.js';

type CheckResult = { ok: boolean; label: string; detail?: string };

const FEED_FRESH_MS = 48 * 60 * 60 * 1000;

export async function doctorCommand(_args: string[]): Promise<number> {
  const results: CheckResult[] = [];
  results.push(checkNodeVersion());
  results.push(checkTripwireDir());
  results.push(checkPlatform());

  try {
    await withStore(repos => {
      const summary = computeSummary(repos);
      results.push({
        ok: summary.daemon.running,
        label: 'daemon is running',
        detail: summary.daemon.running
          ? `last heartbeat ${summary.daemon.last_heartbeat}`
          : 'start it with: brew services start tripwire (or tripwire daemon run)',
      });

      const feed = repos.feedState.get();
      const fresh =
        feed.lastSyncAt !== null && Date.now() - Date.parse(feed.lastSyncAt) < FEED_FRESH_MS;
      results.push({
        ok: fresh,
        label: 'IoC feed refreshed in the last 48h',
        detail: feed.lastSyncAt
          ? `last sync ${feed.lastSyncAt} · ${repos.iocs.count()} IoCs`
          : 'never synced — run: tripwire ioc sync',
      });
    });
  } catch (err) {
    if (err instanceof DbNotFoundError) {
      results.push({ ok: false, label: '~/.tripwire/events.db exists', detail: 'run: tripwire setup' });
    } else {
      throw err;
    }
  }

  let bad = 0;
  for (const r of results) {
    const sigil = r.ok ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
    process.stdout.write(`${sigil}  ${r.label}\n`);
    if (r.detail) process.stdout.write(`   ${c.dim}${r.detail}${c.reset}\n`);
    if (!r.ok) bad++;
  }
  process.stdout.write('\n');
  if (bad === 0) {
    process.stdout.write(`${c.green}All checks passed.${c.reset}\n`);
    return 0;
  }
  process.stdout.write(`${c.yellow}${bad} check${bad === 1 ? '' : 's'} failed.${c.reset}\n`);
  return 1;
}

function checkNodeVersion(): CheckResult {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    ok: major >= 22,
    label: 'Node version ≥ 22',
    detail: `running on Node ${process.versions.node}`,
  };
}

function checkTripwireDir(): CheckResult {
  const paths = cliPaths();
  const ok = existsSync(paths.tripwireDir);
  return {
    ok,
    label: '~/.tripwire/ exists',
    detail: ok ? paths.tripwireDir : 'run: tripwire setup',
  };
}

function checkPlatform(): CheckResult {
  const p = platform();
  return {
    ok: p === 'darwin' || p === 'linux',
    label: 'supported platform (darwin / linux)',
    detail: `running on ${p}`,
  };
}
