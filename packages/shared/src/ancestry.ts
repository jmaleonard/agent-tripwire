export type AncestryCategory =
  | 'human-shell'
  | 'agent-direct'
  | 'agent-subprocess'
  | 'package-manager-direct'
  | 'package-manager-spawned'
  | 'unknown';

export const ANCESTRY_CATEGORIES: readonly AncestryCategory[] = [
  'human-shell',
  'agent-direct',
  'agent-subprocess',
  'package-manager-direct',
  'package-manager-spawned',
  'unknown',
];

// Precedence when multiple categories could apply (spec §6.4.3).
// agent-subprocess wins over package-manager-spawned; agent-direct wins overall.
const PRECEDENCE: Record<AncestryCategory, number> = {
  'agent-direct': 5,
  'agent-subprocess': 4,
  'package-manager-direct': 3,
  'package-manager-spawned': 2,
  'human-shell': 1,
  unknown: 0,
};

export function pickHighestPrecedence(
  candidates: readonly AncestryCategory[],
): AncestryCategory {
  if (candidates.length === 0) return 'unknown';
  let best = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const c = candidates[i]!;
    if (PRECEDENCE[c] > PRECEDENCE[best]) best = c;
  }
  return best;
}
