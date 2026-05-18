import type { Ancestry, AncestryNode, ProcessReader } from './types.js';

export interface WalkOptions {
  identityEnvKeys: ReadonlySet<string>;
  /** Safety cap on how far up the tree we go. Default 32. */
  maxDepth?: number;
}

/**
 * Walk parent → init for a pid. Returns the chain root-first
 * (so `chain[length-1]` is the firing process, matching spec §6.4.1).
 *
 * - Cycle detection: a process whose ppid loops back into the chain stops.
 * - Depth cap: bail at maxDepth even if not at PID 1.
 * - Missing processes (race conditions): walk stops at the first null read.
 * - Env filtering: only `identityEnvKeys` are retained on each node.
 */
export async function walkAncestry(
  reader: ProcessReader,
  pid: number,
  opts: WalkOptions,
): Promise<Ancestry> {
  const max = opts.maxDepth ?? 32;
  const seen = new Set<number>();
  const chainBottomUp: AncestryNode[] = [];

  let current: number | null = pid;
  while (current !== null && chainBottomUp.length < max) {
    if (seen.has(current)) break;
    seen.add(current);

    const raw = await reader.read(current);
    if (!raw) break;

    chainBottomUp.push({
      pid: raw.pid,
      exe: raw.exe,
      argv: raw.argv,
      identityEnv: filterEnv(raw.env, opts.identityEnvKeys),
    });

    if (raw.ppid <= 0 || raw.ppid === raw.pid) break;
    current = raw.ppid;
  }

  return chainBottomUp.reverse();
}

function filterEnv(
  env: Record<string, string>,
  keys: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  return out;
}
