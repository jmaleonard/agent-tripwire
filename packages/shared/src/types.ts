import type { AncestryCategory } from './ancestry.js';
import type { Severity } from './severity.js';

export type EventSource = 'fs_watcher' | 'net_correlator' | 'manual';

export type EventKind = 'read' | 'write' | 'open' | 'create' | 'unlink' | 'rename';

export type Ecosystem = 'npm' | 'pypi' | 'other';

export type UserAction = 'pending' | 'allowlisted' | 'dismissed' | 'investigated';

export interface IoCAttribution {
  source: string;
  campaign?: string;
}

export interface ProcessIdentity {
  pid: number;
  process_path: string;
  argv: string[];
  parent_agent_session_id: string | null;
  ancestry_summary_hash: string;
  ancestry_summary?: string[];
  category: AncestryCategory;
}

export interface PackageRef {
  ecosystem: Ecosystem;
  name: string;
  version: string;
  ioc_attribution?: IoCAttribution[];
}

export interface TripwireEvent {
  event_id: string;
  timestamp: string;
  source: EventSource;
  severity: Severity;
  rule_id: string;
  rule_name?: string;
  path?: string;
  event_kind?: EventKind;
  identity: ProcessIdentity;
  package?: PackageRef;
  snoozed?: boolean;
  notified?: boolean;
  user_action?: UserAction;
}

export type RuleCategory =
  | 'credential-access'
  | 'persistence'
  | 'defense-evasion'
  | 'exfiltration'
  | 'metadata';

export interface PathPredicate {
  home_relative?: string[];
  glob?: string[];
  starts_with?: string[];
  equals?: string[];
}

export interface AncestryCategoryPredicate {
  in?: AncestryCategory[];
  not_in?: AncestryCategory[];
}

export interface EcosystemPredicate {
  in?: Ecosystem[];
  not_in?: Ecosystem[];
}

export interface RuleAppliesTo {
  event_kind?: EventKind[];
  path?: PathPredicate;
  ancestry_category?: AncestryCategoryPredicate;
  ecosystem?: EcosystemPredicate;
}

export interface Rule {
  id: string;
  name: string;
  severity: Severity;
  category: RuleCategory;
  description: string;
  applies_to: RuleAppliesTo;
  references?: string[];
  authored?: string;
  tags?: string[];
  disabled?: boolean;
  deprecated?: boolean;
  replaced_by?: string;
}

export type SnoozeKind = 'this' | 'all';

export interface Snooze {
  id?: number;
  kind: SnoozeKind;
  rule_id?: string;
  ancestry_hash?: string;
  expires_at: string;
  created_at: string;
  reason?: string;
}

export type AllowlistScope = 'rule+ancestry' | 'rule+process' | 'rule';

export interface AllowlistEntry {
  id?: number;
  scope: AllowlistScope;
  rule_id?: string;
  ancestry_hash?: string;
  process_path?: string;
  path_pattern?: string;
  reason?: string;
  created_at: string;
}

export interface IoCSource {
  name: string;
  metadata?: Record<string, unknown>;
}

export interface IoCEntry {
  id?: number;
  ecosystem: Ecosystem;
  package: string;
  version_spec: string;
  sources: IoCSource[];
  campaign?: string;
  first_seen: string;
  last_seen: string;
}

/**
 * The full snapshot artifact the seeder publishes (release asset
 * `latest.json`). Same shape the lambda/CI writes and the client parses.
 */
export interface IoCSnapshot {
  generated_at: string;
  /** ISO date (YYYY-MM-DD) the snapshot is keyed under. */
  date: string;
  entries: IoCEntry[];
}

/** Identity of an IoC entry, used to express a removal in a delta. */
export interface IoCRemoval {
  ecosystem: Ecosystem;
  package: string;
  version_spec: string;
}

/**
 * The diff between two consecutive snapshots. `added` carries full entries
 * (new or changed — applied via upsert); `removed` carries just the identity
 * tuples to delete. Applying a delta to its `base_date` snapshot yields the
 * `date` snapshot.
 */
export interface IoCDelta {
  feed_version: number;
  /** Date of the snapshot this delta applies on top of. */
  base_date: string;
  /** Date of the snapshot this delta produces. */
  date: string;
  generated_at: string;
  added: IoCEntry[];
  removed: IoCRemoval[];
}

/** Pointer to the baseline full snapshot in the manifest. */
export interface FeedFullRef {
  date: string;
  url: string;
  sha256: string;
  count: number;
  bytes: number;
}

/** Pointer to one delta in the manifest, newest last. */
export interface FeedDeltaRef {
  date: string;
  base_date: string;
  url: string;
  sha256: string;
  added: number;
  removed: number;
}

/**
 * The small index a client fetches first. `full` is the baseline to download
 * when too far behind; `deltas` is the ordered chain (oldest→newest) of diffs
 * available on top of `full.date`.
 */
export interface FeedManifest {
  feed_version: number;
  generated_at: string;
  latest_date: string;
  full: FeedFullRef;
  deltas: FeedDeltaRef[];
}
