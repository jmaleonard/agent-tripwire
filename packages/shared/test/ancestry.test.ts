import { describe, expect, it } from 'vitest';
import { ANCESTRY_CATEGORIES, pickHighestPrecedence } from '../src/ancestry.js';

describe('ancestry', () => {
  it('exports all six categories', () => {
    expect(ANCESTRY_CATEGORIES).toHaveLength(6);
  });

  it('agent-subprocess wins over package-manager-spawned (spec §6.4.3)', () => {
    expect(
      pickHighestPrecedence(['package-manager-spawned', 'agent-subprocess']),
    ).toBe('agent-subprocess');
  });

  it('agent-direct wins over everything', () => {
    expect(
      pickHighestPrecedence([
        'unknown',
        'human-shell',
        'package-manager-spawned',
        'agent-subprocess',
        'package-manager-direct',
        'agent-direct',
      ]),
    ).toBe('agent-direct');
  });

  it('falls back to unknown for empty input', () => {
    expect(pickHighestPrecedence([])).toBe('unknown');
  });

  it('returns the only candidate when length is 1', () => {
    expect(pickHighestPrecedence(['human-shell'])).toBe('human-shell');
  });

  it('human-shell beats unknown', () => {
    expect(pickHighestPrecedence(['unknown', 'human-shell'])).toBe('human-shell');
  });
});
