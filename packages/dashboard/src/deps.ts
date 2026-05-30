import type { TripwireEvent } from '@tripwire/shared';
import type {
  AllowlistRepository,
  EventRepository,
  FeedStateRepository,
  IoCRepository,
  SnoozeRepository,
} from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';

export interface DashboardDeps {
  events: EventRepository;
  snoozes: SnoozeRepository;
  allowlist: AllowlistRepository;
  iocs: IoCRepository;
  /** IoC feed sync bookmark, surfaced at `GET /api/iocs/sync`. Optional. */
  feedState?: FeedStateRepository;
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
  /**
   * Hook for `POST /api/iocs/sync`: pulls the published IoC feed into the
   * local store and returns the sync result. Wired by the daemon. When
   * undefined, the endpoint replies 503.
   */
  onSyncIocs?: () => Promise<unknown>;
}
