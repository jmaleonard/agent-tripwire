import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProcessReader, RawProcess } from './types.js';

export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = async (cmd, args) => {
  return promisify(execFile)(cmd, args, { encoding: 'utf-8', maxBuffer: 1 << 20 });
};

/**
 * macOS ProcessReader backed by `ps`. Returns pid / ppid / exe / argv.
 *
 * KNOWN GAP: env vars come back empty. Reading process env on macOS
 * requires the `KERN_PROCARGS2` sysctl, which Node doesn't expose. The
 * planned native helper will fill this in; until then, agent-session
 * attribution on macOS falls back to exe-path matching only (no env
 * markers). Spec §6.4.4 documents the cooperation ask.
 */
export class MacosProcessReader implements ProcessReader {
  constructor(private readonly exec: ExecFn = defaultExec) {}

  async read(pid: number): Promise<RawProcess | null> {
    try {
      // Two queries: comm gives a clean basename (no whitespace, no truncation),
      // args is best-effort argv (may split paths with spaces but it's the only
      // way to see argv beyond [0]).
      const [{ stdout: basic }, argsResult] = await Promise.all([
        this.exec('ps', ['-p', String(pid), '-o', 'pid=,ppid=,comm=']),
        this.exec('ps', ['-ww', '-p', String(pid), '-o', 'args=']).catch(() => ({ stdout: '' })),
      ]);
      const basicLine = basic.split('\n').find(l => l.trim().length > 0);
      if (!basicLine) return null;
      const match = basicLine.match(/^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/);
      if (!match) return null;
      const exe = match[3]!;
      const argLine = argsResult.stdout.trim();
      const argv = argLine.length ? argLine.split(/\s+/) : [exe];
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        exe,
        argv,
        env: {},
      };
    } catch {
      return null;
    }
  }
}
