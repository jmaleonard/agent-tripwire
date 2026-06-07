import { isAtLeast, type TripwireEvent } from '@tripwire/shared';
import { formatEvent } from './format.js';
import type { NotificationPayload, Notifier, NotifyOptions } from './types.js';

/**
 * Captures notifications in memory. Used by tests and the CLI's
 * `tripwire test-notification --dry-run`.
 */
export class MockNotifier implements Notifier {
  readonly sent: Array<{ event: TripwireEvent; payload: NotificationPayload }> = [];
  readonly skipped: Array<{ event: TripwireEvent; reason: 'snoozed' | 'below-threshold' }> = [];

  async notify(event: TripwireEvent, opts: NotifyOptions = {}): Promise<boolean> {
    if (event.snoozed) {
      this.skipped.push({ event, reason: 'snoozed' });
      return false;
    }
    const threshold = opts.minSeverity ?? 'medium';
    if (!isAtLeast(event.severity, threshold)) {
      this.skipped.push({ event, reason: 'below-threshold' });
      return false;
    }
    this.sent.push({ event, payload: formatEvent(event) });
    return true;
  }

  clear(): void {
    this.sent.length = 0;
    this.skipped.length = 0;
  }
}
