import type {
  AllowlistRepository,
  EventRepository,
  IoCRepository,
  SnoozeRepository,
} from '@tripwire/store';

export interface DashboardDeps {
  events: EventRepository;
  snoozes: SnoozeRepository;
  allowlist: AllowlistRepository;
  iocs: IoCRepository;
  /** Override the clock for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}
