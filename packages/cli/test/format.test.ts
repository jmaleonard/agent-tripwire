import { describe, expect, it } from 'vitest';
import { relativeTime, renderTable, severityBadge } from '../src/format.js';

describe('relativeTime', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');

  it('returns "just now" for very recent', () => {
    expect(relativeTime('2026-05-26T11:59:58.000Z', now)).toBe('just now');
  });

  it('returns "Ns ago" for sub-minute', () => {
    expect(relativeTime('2026-05-26T11:59:30.000Z', now)).toBe('30s ago');
  });

  it('returns "Nm ago" for sub-hour', () => {
    expect(relativeTime('2026-05-26T11:45:00.000Z', now)).toBe('15m ago');
  });

  it('returns "Nh ago" for sub-day', () => {
    expect(relativeTime('2026-05-26T08:00:00.000Z', now)).toBe('4h ago');
  });

  it('returns "Nd ago" for days', () => {
    expect(relativeTime('2026-05-24T12:00:00.000Z', now)).toBe('2d ago');
  });
});

describe('severityBadge', () => {
  it('returns a non-empty string containing the severity in uppercase', () => {
    const got = severityBadge('high');
    expect(got).toContain('HIGH');
  });
});

describe('renderTable', () => {
  it('renders header, separator, and rows', () => {
    const out = renderTable(
      [{ label: 'ID', align: 'right' }, { label: 'NAME' }],
      [
        ['1', 'foo'],
        ['10', 'bar'],
      ],
    );
    const lines = out.split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('ID');
    expect(lines[0]).toContain('NAME');
    expect(lines[2]).toContain('foo');
    expect(lines[3]).toContain('bar');
  });

  it('right-aligns numeric column', () => {
    const out = renderTable(
      [{ label: 'ID', align: 'right' }, { label: 'NAME' }],
      [['1', 'foo'], ['100', 'bar']],
    );
    const lines = out.split('\n').slice(2); // skip header + sep
    // The single-digit '1' should be padded to width=3 (the widest is '100')
    // so it appears as "  1" before two-space separator and "foo".
    expect(lines[0]).toMatch(/^\s+1\s\sfoo/);
  });
});
