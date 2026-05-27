import type { Logger, Severity, TripwireEvent } from '@tripwire/shared';
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
  /** Passed to notifier.notify so click-to-open lands on the right URL. */
  dashboardUrl?: string;
  /** Notifier severity threshold; defaults to `medium`. */
  minSeverity?: Severity;
  /** Override the path-match home (mostly for tests). */
  home?: string;
}

/**
 * One full pipeline turn: identify → engine → store → notify.
 *
 * - pid=null events (macOS read gap) are dropped silently — no identity, no
 *   classification, no rule eval.
 * - Process gone before we read /proc → dropped.
 * - Storage always happens. Notifier failure does NOT prevent storage.
 * - On notify success, the event is marked notified in the DB.
 *
 * Returns the TripwireEvents that were emitted (zero when no rule matched).
 */
export async function handleFsEvent(deps: PipelineDeps, fsEvent: FsEvent): Promise<TripwireEvent[]> {
  if (fsEvent.pid === null) {
    deps.logger.debug({ fsEvent }, 'skipping fs event with null pid');
    return [];
  }
  const identity = await identify(fsEvent.pid, {
    reader: deps.processReader,
    config: deps.classifierConfig,
    identityEnvKeys: deps.identityEnvKeys,
  });
  if (!identity) {
    deps.logger.debug({ pid: fsEvent.pid }, 'process gone before identify');
    return [];
  }

  const evaluated = deps.engine.evaluate(fsEvent, identity, {
    ...(deps.home !== undefined ? { home: deps.home } : {}),
  });

  for (const event of evaluated) {
    deps.events.insert(event);
    try {
      const notified = await deps.notifier.notify(event, {
        ...(deps.dashboardUrl !== undefined ? { dashboardUrl: deps.dashboardUrl } : {}),
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
