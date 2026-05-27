import { basename } from 'node:path';
import type { AncestryCategory, TripwireEvent } from '@tripwire/shared';
import type { NotificationPayload, NotifyOptions } from './types.js';

/**
 * Human-friendly notification payload. Past tense (spec §6.6.1). Compresses
 * ~/ paths. Three lines for macOS: title (what fired), subtitle (who), body
 * (action + path, plus IoC line when relevant). Designed to fit a banner —
 * short, scannable, no rule_id jargon.
 */
export function formatEvent(
  event: TripwireEvent,
  opts: NotifyOptions = {},
): NotificationPayload {
  const rule = event.rule_name ?? event.rule_id;
  const title = severityPrefix(event.severity) + rule;

  const procName = friendlyProcName(event.identity);
  const subtitle = actorPhrase(event.identity.category, procName);

  const path = compressHome(event.path ?? '<unknown path>');
  const verb = pastTense(event.event_kind);
  const bodyParts: string[] = [`${verb} ${path}`];
  if (event.package?.name) {
    const camp = event.package.ioc_attribution?.find(a => a.campaign)?.campaign;
    const sources = event.package.ioc_attribution?.map(a => a.source).join('/');
    if (camp && sources) {
      bodyParts.push(`${event.package.name} flagged by ${sources} as ${camp}`);
    } else if (sources) {
      bodyParts.push(`${event.package.name} flagged by ${sources}`);
    } else {
      bodyParts.push(`from package ${event.package.name}`);
    }
  }

  const payload: NotificationPayload = {
    title,
    subtitle,
    body: bodyParts.join(' · '),
    severity: event.severity,
  };
  if (opts.dashboardUrl !== undefined) {
    payload.openUrl = `${opts.dashboardUrl.replace(/\/$/, '')}/events/${event.event_id}`;
  }
  return payload;
}

function severityPrefix(severity: TripwireEvent['severity']): string {
  switch (severity) {
    case 'critical': return '🚨 ';
    case 'high':     return '⚠️ ';
    default:         return '';
  }
}

function pastTense(kind: TripwireEvent['event_kind']): string {
  switch (kind) {
    case 'read':   return 'read';
    case 'open':   return 'opened';
    case 'write':  return 'wrote to';
    case 'create': return 'created';
    case 'unlink': return 'deleted';
    case 'rename': return 'renamed';
    default:       return 'touched';
  }
}

function compressHome(path: string): string {
  const home = process.env.HOME;
  if (home && path === home) return '~';
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`;
  // macOS often reports /private/tmp/x for /tmp/x.
  if (path.startsWith('/private/')) return path.slice('/private'.length);
  return path;
}

function friendlyProcName(identity: TripwireEvent['identity']): string | undefined {
  // Hide the synthetic identity (pid=-1, process_path="<unknown>") so we
  // don't display "by <unknown>".
  if (identity.pid < 0 || identity.process_path === '<unknown>') return undefined;
  const name = basename(identity.process_path);
  return name && name !== '<unknown>' ? name : undefined;
}

function actorPhrase(category: AncestryCategory, proc: string | undefined): string {
  switch (category) {
    case 'agent-direct':
      return proc ? `${proc} (coding agent)` : 'a coding agent';
    case 'agent-subprocess':
      return proc ? `${proc}, via an agent` : 'via an agent subprocess';
    case 'package-manager-direct':
      return proc ? `${proc} (package manager)` : 'a package manager';
    case 'package-manager-spawned':
      return proc ? `${proc}, via a package-manager script` : 'via a package-manager script';
    case 'human-shell':
      return proc ? `${proc}, from your shell` : 'from your shell';
    case 'unknown':
      return proc ? `by ${proc}` : 'by an unknown process';
  }
}
