import { randomUUID } from 'node:crypto';
import type {
  PackageRef,
  ProcessIdentity,
  Rule,
  TripwireEvent,
} from '@tripwire/shared';
import type {
  AllowlistRepository,
  IoCRepository,
  SnoozeRepository,
} from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';
import { attributePackage, enrichWithIoc } from './enricher.js';
import { type PathMatchOptions } from './path-match.js';
import { ruleApplies } from './rule-match.js';

export interface EngineDeps {
  rules: ReadonlyArray<Rule>;
  allowlist: AllowlistRepository;
  snoozes: SnoozeRepository;
  iocs: IoCRepository;
}

export interface EvaluateOptions extends PathMatchOptions {
  /** Override clock (for tests). Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Override the event_id generator (for tests). Defaults to randomUUID. */
  eventId?: () => string;
}

/**
 * The rule engine. Takes an FsEvent + ProcessIdentity, runs every loaded rule's
 * predicates, suppresses allowlisted (rule, ancestry) tuples, and tags
 * snoozed events. Returns 0..N TripwireEvents — one per matching rule that
 * survived allowlist check. Snoozed events are returned with `snoozed: true`
 * so the caller can decide whether to notify (no) and persist (yes).
 */
export class Engine {
  constructor(private readonly deps: EngineDeps) {}

  evaluate(
    event: FsEvent,
    identity: ProcessIdentity,
    opts: EvaluateOptions = {},
  ): TripwireEvent[] {
    const out: TripwireEvent[] = [];
    const pkg = this.attributeAndEnrich(identity);
    const matchInput = { event, identity, package: pkg };
    const matchOpts: PathMatchOptions = {
      ...(opts.home !== undefined ? { home: opts.home } : {}),
    };

    for (const rule of this.deps.rules) {
      if (!ruleApplies(rule, matchInput, matchOpts)) continue;

      const allowed = this.deps.allowlist.matches({
        ruleId: rule.id,
        ancestryHash: identity.ancestry_summary_hash,
        processPath: identity.process_path,
        path: event.path,
      });
      if (allowed !== null) continue;

      const now = opts.now ? opts.now() : new Date();
      const snoozed = this.deps.snoozes.isSnoozed({
        ruleId: rule.id,
        ancestryHash: identity.ancestry_summary_hash,
        now,
      });

      out.push({
        event_id: (opts.eventId ?? randomUUID)(),
        timestamp: event.timestamp,
        source: 'fs_watcher',
        severity: rule.severity,
        rule_id: rule.id,
        rule_name: rule.name,
        path: event.path,
        event_kind: event.kind,
        identity,
        ...(pkg !== null ? { package: pkg } : {}),
        snoozed,
        notified: false,
        user_action: 'pending',
      });
    }
    return out;
  }

  private attributeAndEnrich(identity: ProcessIdentity): PackageRef | null {
    const base = attributePackage(identity.process_path);
    if (!base) return null;
    return enrichWithIoc(base, this.deps.iocs);
  }
}
