import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { ApiClient } from '../api.js';
import { c } from '../format.js';

const exec = promisify(execFile);

export async function dashboardCommand(_args: string[]): Promise<number> {
  const api = new ApiClient();
  if (!(await api.isReachable())) {
    process.stderr.write(`${c.red}Daemon not reachable.${c.reset} Start it with: tripwire daemon run\n`);
    return 2;
  }
  const url = process.env.TRIPWIRE_URL ?? 'http://127.0.0.1:7878';
  process.stdout.write(`${c.cyan}Opening ${url}…${c.reset}\n`);
  const opener = platform() === 'darwin' ? 'open' : 'xdg-open';
  try {
    await exec(opener, [url]);
  } catch (err) {
    process.stderr.write(`Could not launch browser: ${(err as Error).message}\n`);
    process.stderr.write(`Open ${url} in your browser.\n`);
    return 1;
  }
  return 0;
}
