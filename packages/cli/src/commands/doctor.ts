import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { ApiClient } from '../api.js';
import { cliPaths } from '../config.js';
import { c } from '../format.js';

type CheckResult = { ok: boolean; label: string; detail?: string };

export async function doctorCommand(_args: string[]): Promise<number> {
  const results: CheckResult[] = [];
  results.push(checkNodeVersion());
  results.push(checkTripwireDir());
  results.push(await checkDaemonReachable());
  results.push(checkPlatform());

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
  const ok = major >= 22;
  return {
    ok,
    label: `Node version ≥ 22`,
    detail: `running on Node ${process.versions.node}`,
  };
}

function checkTripwireDir(): CheckResult {
  const paths = cliPaths();
  const ok = existsSync(paths.tripwireDir);
  return {
    ok,
    label: `~/.tripwire/ exists`,
    detail: ok ? paths.tripwireDir : `run: tripwire setup`,
  };
}

async function checkDaemonReachable(): Promise<CheckResult> {
  const api = new ApiClient();
  const ok = await api.isReachable();
  const label = `daemon is reachable at ${process.env.TRIPWIRE_URL ?? 'http://127.0.0.1:7878'}`;
  return ok
    ? { ok: true, label }
    : { ok: false, label, detail: 'start it with: tripwire daemon run' };
}

function checkPlatform(): CheckResult {
  const p = platform();
  const ok = p === 'darwin' || p === 'linux';
  return {
    ok,
    label: `supported platform (darwin / linux)`,
    detail: `running on ${p}`,
  };
}
