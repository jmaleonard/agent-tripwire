export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const ORDER: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const SEVERITIES: readonly Severity[] = ['info', 'low', 'medium', 'high', 'critical'];

export function compareSeverity(a: Severity, b: Severity): number {
  return ORDER[a] - ORDER[b];
}

export function isAtLeast(value: Severity, threshold: Severity): boolean {
  return ORDER[value] >= ORDER[threshold];
}
