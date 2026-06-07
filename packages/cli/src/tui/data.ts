import type { TripwireEvent } from '@tripwire/shared';
import { computeSummary, type Summary } from '@tripwire/store';
import type { CliRepos } from '../store.js';

export interface TuiState {
  summary: Summary;
  events: TripwireEvent[];
}

/** How many recent events the TUI pages over. */
const EVENT_LIMIT = 200;
/** "Snooze this" duration from the TUI — matches the default 1h preset feel. */
const SNOOZE_MS = 60 * 60 * 1000;

/** Snapshot the store for the TUI: header summary + a page of recent events. */
export function loadTuiState(repos: CliRepos, now: Date = new Date()): TuiState {
  return {
    summary: computeSummary(repos, { now, recentLimit: 5 }),
    events: repos.events.list({ limit: EVENT_LIMIT }),
  };
}

/** Allowlist this event's (rule, ancestry) pair so it stops firing. */
export function allowlistEvent(repos: CliRepos, event: TripwireEvent, now: Date = new Date()): void {
  repos.allowlist.add({
    scope: 'rule+ancestry',
    rule_id: event.rule_id,
    ancestry_hash: event.identity.ancestry_summary_hash,
    reason: 'allowlisted from tui',
    created_at: now.toISOString(),
  });
  repos.events.setUserAction(event.event_id, 'allowlisted');
}

/** Snooze this event's (rule, ancestry) tuple for an hour. */
export function snoozeEvent(repos: CliRepos, event: TripwireEvent, now: Date = new Date()): void {
  repos.snoozes.add({
    kind: 'this',
    rule_id: event.rule_id,
    ancestry_hash: event.identity.ancestry_summary_hash,
    expires_at: new Date(now.getTime() + SNOOZE_MS).toISOString(),
    created_at: now.toISOString(),
    reason: 'snoozed from tui',
  });
}

/** Mark this event dismissed (kept in the store, flagged handled). */
export function dismissEvent(repos: CliRepos, event: TripwireEvent): void {
  repos.events.setUserAction(event.event_id, 'dismissed');
}
