const MAX_MS = 24 * 60 * 60 * 1000;

export interface ParseDurationOptions {
  now?: Date;
  /** "HH:MM" — used by the `until_morning` preset. Default "09:00". */
  morningTime?: string;
}

/**
 * Parse a snooze window like "5m" / "15m" / "1h" / "4h" / "until_morning"
 * into an absolute expires-at Date. Spec §6.7.2 hard-caps the window at 24h.
 */
export function parseSnoozeWindow(input: string, opts: ParseDurationOptions = {}): Date {
  const now = opts.now ?? new Date();
  if (input === 'until_morning') {
    const [hh, mm] = (opts.morningTime ?? '09:00').split(':').map(Number);
    if (
      hh === undefined || mm === undefined ||
      Number.isNaN(hh) || Number.isNaN(mm) ||
      hh < 0 || hh > 23 || mm < 0 || mm > 59
    ) {
      throw new Error(`invalid morningTime: ${opts.morningTime}`);
    }
    const target = new Date(now);
    target.setHours(hh, mm, 0, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    const ms = target.getTime() - now.getTime();
    if (ms > MAX_MS) {
      throw new Error('snooze longer than 24h is not allowed');
    }
    return target;
  }
  const match = input.match(/^(\d+)([smh])$/);
  if (!match) {
    throw new Error(`cannot parse snooze window: ${input}`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  const ms =
    unit === 's' ? value * 1000 :
    unit === 'm' ? value * 60_000 :
    /* unit === 'h' */ value * 3_600_000;
  if (ms <= 0) throw new Error('snooze window must be > 0');
  if (ms > MAX_MS) throw new Error('snooze longer than 24h is not allowed');
  return new Date(now.getTime() + ms);
}

/** Human-readable remaining time. "23h 14m" / "5m" / "<1m" / "expired" */
export function formatRemaining(expiresAt: string, now: Date = new Date()): string {
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return 'expired';
  const minutes = Math.floor(remaining / 60_000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
