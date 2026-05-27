import { describe, expect, it } from 'vitest';
import { formatRemaining, parseSnoozeWindow } from '../src/duration.js';

describe('parseSnoozeWindow', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');

  it('parses 5m / 15m / 1h / 4h', () => {
    expect(parseSnoozeWindow('5m', { now }).toISOString()).toBe('2026-05-26T12:05:00.000Z');
    expect(parseSnoozeWindow('15m', { now }).toISOString()).toBe('2026-05-26T12:15:00.000Z');
    expect(parseSnoozeWindow('1h', { now }).toISOString()).toBe('2026-05-26T13:00:00.000Z');
    expect(parseSnoozeWindow('4h', { now }).toISOString()).toBe('2026-05-26T16:00:00.000Z');
  });

  it('parses seconds (testing helper)', () => {
    expect(parseSnoozeWindow('30s', { now }).toISOString()).toBe('2026-05-26T12:00:30.000Z');
  });

  it('rejects 0 and negative durations', () => {
    expect(() => parseSnoozeWindow('0m', { now })).toThrow(/> 0/);
  });

  it('rejects > 24h', () => {
    expect(() => parseSnoozeWindow('25h', { now })).toThrow(/24h/);
  });

  it('rejects malformed input', () => {
    expect(() => parseSnoozeWindow('forever', { now })).toThrow(/cannot parse/);
    expect(() => parseSnoozeWindow('5', { now })).toThrow(/cannot parse/);
  });

  // until_morning uses local-time setHours, so we assert relative properties
  // (next morning + < 24h ahead) instead of pinning UTC timestamps.

  it("'until_morning' returns a local-time HH:MM in the future", () => {
    const now = new Date();
    const got = parseSnoozeWindow('until_morning', { now, morningTime: '09:00' });
    expect(got.getTime()).toBeGreaterThan(now.getTime());
    expect(got.getHours()).toBe(9);
    expect(got.getMinutes()).toBe(0);
  });

  it("'until_morning' is always <= 24h ahead", () => {
    const now = new Date();
    const got = parseSnoozeWindow('until_morning', { now, morningTime: '09:00' });
    const diffMs = got.getTime() - now.getTime();
    expect(diffMs).toBeGreaterThan(0);
    expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });

  it("'until_morning' rejects invalid hour/minute", () => {
    expect(() =>
      parseSnoozeWindow('until_morning', { now, morningTime: '99:99' }),
    ).toThrow(/invalid morningTime/);
    expect(() =>
      parseSnoozeWindow('until_morning', { now, morningTime: '24:00' }),
    ).toThrow(/invalid morningTime/);
    expect(() =>
      parseSnoozeWindow('until_morning', { now, morningTime: 'nope' }),
    ).toThrow(/invalid morningTime/);
  });
});

describe('formatRemaining', () => {
  const now = new Date('2026-05-26T12:00:00.000Z');

  it('returns expired when already past', () => {
    expect(formatRemaining('2026-05-26T11:00:00.000Z', now)).toBe('expired');
  });

  it('returns "<1m" for very small windows', () => {
    expect(formatRemaining('2026-05-26T12:00:30.000Z', now)).toBe('<1m');
  });

  it('returns minutes when < 60', () => {
    expect(formatRemaining('2026-05-26T12:14:00.000Z', now)).toBe('14m');
  });

  it('returns "Xh Ym" with minutes', () => {
    expect(formatRemaining('2026-05-26T13:14:00.000Z', now)).toBe('1h 14m');
  });

  it('omits minutes when zero', () => {
    expect(formatRemaining('2026-05-26T15:00:00.000Z', now)).toBe('3h');
  });
});
