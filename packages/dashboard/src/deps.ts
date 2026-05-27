import type { TripwireEvent } from '@tripwire/shared';
import type {
  AllowlistRepository,
  EventRepository,
  IoCRepository,
  SnoozeRepository,
} from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';

export interface DashboardDeps {
  events: EventRepository;
  snoozes: SnoozeRepository;
  allowlist: AllowlistRepository;
  iocs: IoCRepository;
  /** Override the clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
  /**
   * Hook for the `POST /api/test-event` route: takes a synthetic FsEvent,
   * runs it through the daemon's pipeline, returns the TripwireEvents that
   * fired (after identify + engine + store + notify).
   *
   * Wired by the daemon. When undefined, the test-event endpoint replies 503.
   */
  onTestEvent?: (fsEvent: FsEvent) => Promise<TripwireEvent[]>;
}
