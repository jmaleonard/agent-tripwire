import { describe, expect, it } from 'vitest';
import { compareSeverity, isAtLeast, SEVERITIES } from '../src/severity.js';

describe('severity', () => {
  it('orders critical > high > medium > low > info', () => {
    expect(compareSeverity('critical', 'high')).toBeGreaterThan(0);
    expect(compareSeverity('high', 'medium')).toBeGreaterThan(0);
    expect(compareSeverity('medium', 'low')).toBeGreaterThan(0);
    expect(compareSeverity('low', 'info')).toBeGreaterThan(0);
  });

  it('returns zero for equal severities', () => {
    expect(compareSeverity('high', 'high')).toBe(0);
  });

  it('SEVERITIES is ascending', () => {
    for (let i = 1; i < SEVERITIES.length; i++) {
      expect(compareSeverity(SEVERITIES[i]!, SEVERITIES[i - 1]!)).toBeGreaterThan(0);
    }
  });

  it('isAtLeast respects threshold', () => {
    expect(isAtLeast('critical', 'high')).toBe(true);
    expect(isAtLeast('high', 'high')).toBe(true);
    expect(isAtLeast('medium', 'high')).toBe(false);
    expect(isAtLeast('info', 'low')).toBe(false);
  });
});
