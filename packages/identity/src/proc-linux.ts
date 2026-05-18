import { readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCmdline, parseEnviron, parseStatusPpid } from './parse-linux.js';
import type { ProcessReader, RawProcess } from './types.js';

/**
 * Linux ProcessReader backed by /proc. Tolerates per-file errors (a race
 * where the process exits mid-read returns null overall) and returns
 * best-effort partial data when only some files are unreadable.
 */
export class LinuxProcessReader implements ProcessReader {
  constructor(private readonly procRoot: string = '/proc') {}

  async read(pid: number): Promise<RawProcess | null> {
    const dir = join(this.procRoot, String(pid));

    const [statusRaw, cmdlineRaw, environRaw, exePath] = await Promise.all([
      readFile(join(dir, 'status'), 'utf-8').catch(() => null),
      readFile(join(dir, 'cmdline')).catch(() => null),
      readFile(join(dir, 'environ')).catch(() => null),
      readlink(join(dir, 'exe')).catch(() => ''),
    ]);

    if (statusRaw === null) return null;

    const ppid = parseStatusPpid(statusRaw);
    const argv = cmdlineRaw ? parseCmdline(cmdlineRaw) : [];
    const env = environRaw ? parseEnviron(environRaw) : {};

    return {
      pid,
      ppid,
      exe: exePath || argv[0] || '',
      argv,
      env,
    };
  }
}
