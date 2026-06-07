import type { Severity, TripwireEvent } from '@tripwire/shared';

export interface NotificationPayload {
  title: string;
  /** Second-line text, shown smaller on macOS (terminal-notifier `-subtitle`). */
  subtitle?: string;
  body: string;
  severity: Severity;
}

export interface NotifyOptions {
  /** Skip notifications below this severity. Default 'medium'. */
  minSeverity?: Severity;
}

/**
 * Surface for getting attention. Mock for tests, native per-platform impls
 * for prod. Snooze + severity-threshold checks live in the notifier so
 * skipping these surfaces NEVER skips the store log (spec §6.7.3).
 */
export interface Notifier {
  /** @returns true if a notification was actually dispatched. */
  notify(event: TripwireEvent, opts?: NotifyOptions): Promise<boolean>;
}
