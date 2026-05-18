import type { Severity, TripwireEvent } from '@tripwire/shared';

export interface NotificationPayload {
  title: string;
  body: string;
  /** URL the notification opens when clicked (where supported). */
  openUrl?: string;
  severity: Severity;
}

export interface NotifyOptions {
  /** Base URL of the local dashboard. Used to build `openUrl`. */
  dashboardUrl?: string;
  /** Skip notifications below this severity. Default 'medium'. */
  minSeverity?: Severity;
}

/**
 * Surface for getting attention. Mock for tests, native per-platform impls
 * for prod. Snooze + severity-threshold checks live in the notifier so
 * skipping these surfaces NEVER skips the dashboard log (spec §6.7.3).
 */
export interface Notifier {
  /** @returns true if a notification was actually dispatched. */
  notify(event: TripwireEvent, opts?: NotifyOptions): Promise<boolean>;
}
