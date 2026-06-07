import { createHash } from 'node:crypto';
import type { Logger, ProcessIdentity, Severity, TripwireEvent } from '@tripwire/shared';
import type { Engine } from '@tripwire/engine';
import type { ClassifierConfig, ProcessReader } from '@tripwire/identity';
import { identify } from '@tripwire/identity';
import type { Notifier } from '@tripwire/notifier';
import type { EventRepository } from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';

export interface PipelineDeps {
  engine: Engine;
  events: EventRepository;
  notifier: Notifier;
  processReader: ProcessReader;
  classifierConfig: ClassifierConfig;
  identityEnvKeys: ReadonlySet<string>;
  logger: Logger;
  /** Notifier severity threshold; defaults to `medium`. */
  minSeverity?: Severity;
  /** Override the path-match home (mostly for tests). */
  home?: string;
}

/**
 * One full pipeline turn: identify → engine → store → notify.
 *
 * - pid=null events (macOS fsevents, watcher backends without PID) get a
 *   synthetic 'unknown'-category identity so rules still fire. Snooze /
 *   allowlist hash is derived from the path so the same path snoozes
 *   coherently across firings.
 * - Process gone before we read /proc → dropped.
 * - Storage always happens. Notifier failure does NOT prevent storage.
 * - On notify success, the event is marked notified in the DB.
 *
 * Returns the TripwireEvents that were emitted (zero when no rule matched).
 */
export async function handleFsEvent(deps: PipelineDeps, fsEvent: FsEvent): Promise<TripwireEvent[]> {
  let identity: ProcessIdentity | null;
  if (fsEvent.pid === null) {
    identity = syntheticIdentity(fsEvent);
  } else {
    identity = await identify(fsEvent.pid, {
      reader: deps.processReader,
      config: deps.classifierConfig,
      identityEnvKeys: deps.identityEnvKeys,
    });
    if (!identity) {
      deps.logger.debug({ pid: fsEvent.pid }, 'process gone before identify');
      return [];
    }
  }

  const evaluated = deps.engine.evaluate(fsEvent, identity, {
    ...(deps.home !== undefined ? { home: deps.home } : {}),
  });

  for (const event of evaluated) {
    deps.events.insert(event);
    try {
      const notified = await deps.notifier.notify(event, {
        ...(deps.minSeverity !== undefined ? { minSeverity: deps.minSeverity } : {}),
      });
      if (notified) {
        deps.events.markNotified(event.event_id);
        event.notified = true;
      }
    } catch (err) {
      deps.logger.warn({ err, eventId: event.event_id }, 'notifier failed');
    }
  }
  return evaluated;
}

/**
 * Build a placeholder identity for an FsEvent whose watcher couldn't report a
 * PID (e.g. macOS fsevents). category='unknown', hash derived from the path
 * so snooze-by-this-tuple at least scopes per-path.
 */
function syntheticIdentity(fsEvent: FsEvent): ProcessIdentity {
  const hash = createHash('sha256').update(`unknown:${fsEvent.path}`).digest('hex');
  return {
    pid: -1,
    process_path: '<unknown>',
    argv: [],
    parent_agent_session_id: null,
    ancestry_summary_hash: hash,
    category: 'unknown',
  };
}
