import { createHash } from 'node:crypto';
import type { Ancestry } from './types.js';

/**
 * `ancestry_summary_hash` per spec §6.4.2: stable SHA-256 over the chain of
 * `{exe_path, argv[0]}` from root down. Argv beyond [0] and PIDs are
 * intentionally excluded — the hash should survive process restarts within
 * the same agent session but change when a different agent session spawns
 * a similar tree.
 */
export function ancestrySummaryHash(ancestry: Ancestry): string {
  const hash = createHash('sha256');
  for (const node of ancestry) {
    hash.update(node.exe);
    hash.update('\0');
    hash.update(node.argv[0] ?? '');
    hash.update('\n');
  }
  return hash.digest('hex');
}
