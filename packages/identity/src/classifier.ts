import { basename } from 'node:path';
import { type AncestryCategory, pickHighestPrecedence } from '@tripwire/shared';
import { matchesAnyGlob } from './glob.js';
import type { Ancestry, ClassifierConfig } from './types.js';

/**
 * Implements spec §6.4.3. Collects every category whose condition holds,
 * then picks the highest-precedence one.
 *
 *   agent-direct          firing exe matches an agent glob
 *   agent-subprocess      firing isn't agent, but an ancestor is (by exe or env)
 *   package-manager-direct   firing exe matches a package-manager glob
 *   package-manager-spawned  firing isn't pm, but an ancestor is
 *   human-shell           none of the above, but an ancestor is an interactive shell
 *   unknown               nothing matched
 */
export function classify(ancestry: Ancestry, cfg: ClassifierConfig): AncestryCategory {
  if (ancestry.length === 0) return 'unknown';

  const firing = ancestry[ancestry.length - 1]!;
  const isFiringAgent = matchesAnyGlob(firing.exe, cfg.agentPaths);
  const isFiringPM = matchesAnyGlob(firing.exe, cfg.packageManagerPaths);

  let ancestorIsAgent = false;
  let ancestorIsPM = false;
  let anyHasIdentityEnv = false;

  for (let i = 0; i < ancestry.length; i++) {
    const node = ancestry[i]!;
    if (Object.keys(node.identityEnv).length > 0) {
      anyHasIdentityEnv = true;
    }
    if (i !== ancestry.length - 1) {
      if (matchesAnyGlob(node.exe, cfg.agentPaths)) ancestorIsAgent = true;
      if (matchesAnyGlob(node.exe, cfg.packageManagerPaths)) ancestorIsPM = true;
    }
  }

  const candidates: AncestryCategory[] = [];
  if (isFiringAgent) candidates.push('agent-direct');
  if (!isFiringAgent && (ancestorIsAgent || anyHasIdentityEnv)) {
    candidates.push('agent-subprocess');
  }
  if (isFiringPM) candidates.push('package-manager-direct');
  if (!isFiringPM && ancestorIsPM) candidates.push('package-manager-spawned');

  if (candidates.length === 0) {
    const hasShell = ancestry.some(n => cfg.shellExes.has(basename(n.exe)));
    if (hasShell) candidates.push('human-shell');
  }

  return pickHighestPrecedence(candidates.length > 0 ? candidates : ['unknown']);
}
