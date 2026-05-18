import type { PackageRef, ProcessIdentity, Rule } from '@tripwire/shared';
import type { FsEvent } from '@tripwire/watcher';
import { matchesPath, type PathMatchOptions } from './path-match.js';

export interface RuleMatchInput {
  event: FsEvent;
  identity: ProcessIdentity;
  /** Best-effort package attribution; null when the firing process isn't in node_modules / site-packages. */
  package: PackageRef | null;
}

/**
 * Does this rule apply to (event, identity, package)?
 * All sub-predicates of `applies_to` are AND'd; each is OR'd internally.
 */
export function ruleApplies(
  rule: Rule,
  input: RuleMatchInput,
  opts: PathMatchOptions = {},
): boolean {
  if (rule.disabled) return false;
  const ap = rule.applies_to;

  if (ap.event_kind && !ap.event_kind.includes(input.event.kind)) return false;

  if (ap.path && !matchesPath(input.event.path, ap.path, opts)) return false;

  if (ap.ancestry_category) {
    const cat = input.identity.category;
    if (ap.ancestry_category.in && !ap.ancestry_category.in.includes(cat)) return false;
    if (ap.ancestry_category.not_in?.includes(cat)) return false;
  }

  if (ap.ecosystem) {
    // If the rule requires an ecosystem but we couldn't attribute one, no match.
    if (!input.package) {
      if (ap.ecosystem.in?.length) return false;
    } else {
      if (ap.ecosystem.in && !ap.ecosystem.in.includes(input.package.ecosystem)) return false;
      if (ap.ecosystem.not_in?.includes(input.package.ecosystem)) return false;
    }
  }

  return true;
}
