import type { ProcessIdentity } from '@tripwire/shared';
import { classify } from './classifier.js';
import { ancestrySummaryHash } from './hash.js';
import type { Ancestry, ClassifierConfig, ProcessReader } from './types.js';
import { walkAncestry } from './walker.js';

export interface IdentifyOptions {
  reader: ProcessReader;
  config: ClassifierConfig;
  identityEnvKeys: ReadonlySet<string>;
  maxDepth?: number;
}

/**
 * Convert a kernel-reported PID into a fully-attributed ProcessIdentity
 * (spec §6.4.1). Returns null only when the firing process has already
 * exited and we can't read anything about it.
 */
export async function identify(
  pid: number,
  opts: IdentifyOptions,
): Promise<ProcessIdentity | null> {
  const ancestry = await walkAncestry(opts.reader, pid, {
    identityEnvKeys: opts.identityEnvKeys,
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
  });
  if (ancestry.length === 0) return null;

  const firing = ancestry[ancestry.length - 1]!;
  const category = classify(ancestry, opts.config);
  const hash = ancestrySummaryHash(ancestry);
  const ancestrySummary = ancestry.map(n => `${n.exe}|${n.argv[0] ?? ''}`);
  const agentSessionId = findAgentSessionId(ancestry);

  return {
    pid: firing.pid,
    process_path: firing.exe,
    argv: firing.argv,
    parent_agent_session_id: agentSessionId,
    ancestry_summary_hash: hash,
    ancestry_summary: ancestrySummary,
    category,
  };
}

function findAgentSessionId(ancestry: Ancestry): string | null {
  for (const node of ancestry) {
    for (const [key, value] of Object.entries(node.identityEnv)) {
      // First env marker found wins; walking root → firing so outermost agent
      // session label is preferred over an inner one (rare in practice).
      if (key.endsWith('_SESSION') || key.endsWith('_AGENT_RUN')) {
        return value;
      }
    }
  }
  return null;
}
