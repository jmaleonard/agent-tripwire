import { basename } from 'node:path';
import type { TripwireEvent } from '@tripwire/shared';
import type { NotificationPayload, NotifyOptions } from './types.js';

/**
 * Format a TripwireEvent for native notification. Past-tense always
 * (spec §6.6.1 — "the read already happened").
 */
export function formatEvent(
  event: TripwireEvent,
  opts: NotifyOptions = {},
): NotificationPayload {
  const procName = basename(event.identity.process_path) || 'unknown';
  const path = event.path ?? '<unknown path>';
  const kind = event.event_kind ?? 'touched';
  const ruleLabel = event.rule_name ?? event.rule_id;
  const title = `tripwire: ${event.severity.toUpperCase()} — ${ruleLabel}`;

  const lines: string[] = [
    `${procName} (pid ${event.identity.pid}) just ${pastTense(kind)} ${path}`,
  ];

  if (event.package) {
    lines.push(formatPackageLine(event.package));
  }
  lines.push(`rule: ${event.rule_id}`);
  lines.push(`ancestry: ${event.identity.category}`);

  const payload: NotificationPayload = {
    title,
    body: lines.join('\n'),
    severity: event.severity,
  };
  if (opts.dashboardUrl !== undefined) {
    payload.openUrl = `${opts.dashboardUrl.replace(/\/$/, '')}/events/${event.event_id}`;
  }
  return payload;
}

function pastTense(kind: string): string {
  switch (kind) {
    case 'read': return 'read';
    case 'open': return 'opened';
    case 'write': return 'wrote to';
    case 'create': return 'created';
    case 'unlink': return 'deleted';
    case 'rename': return 'renamed';
    default: return `touched (${kind})`;
  }
}

function formatPackageLine(pkg: NonNullable<TripwireEvent['package']>): string {
  let line = `package: ${pkg.name}`;
  if (pkg.version && pkg.version !== 'unknown') line += `@${pkg.version}`;
  if (pkg.ioc_attribution && pkg.ioc_attribution.length > 0) {
    const sources = pkg.ioc_attribution.map(a => a.source).join(', ');
    const campaign = pkg.ioc_attribution.find(a => a.campaign)?.campaign;
    line += campaign
      ? ` (flagged by ${sources} as ${campaign})`
      : ` (flagged by ${sources})`;
  }
  return line;
}
