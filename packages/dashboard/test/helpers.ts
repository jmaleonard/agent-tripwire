import type { TripwireEvent } from '@tripwire/shared';
import {
  AllowlistRepository,
  EventRepository,
  IoCRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import { createDashboard } from '../src/server.js';
import type { DashboardDeps } from '../src/deps.js';

export interface TestHarness {
  app: ReturnType<typeof createDashboard>;
  deps: DashboardDeps;
  db: DbHandle;
  close: () => void;
}

export function makeHarness(now: Date = new Date('2026-05-26T12:00:00.000Z')): TestHarness {
  const db = openDb({ path: ':memory:' });
  const deps: DashboardDeps = {
    events: new EventRepository(db),
    snoozes: new SnoozeRepository(db),
    allowlist: new AllowlistRepository(db),
    iocs: new IoCRepository(db),
    now: () => now,
  };
  return { app: createDashboard(deps), deps, db, close: () => db.close() };
}

export function makeEvent(overrides: Partial<TripwireEvent> = {}): TripwireEvent {
  return {
    event_id: 'evt-1',
    timestamp: '2026-05-26T11:55:00.000Z',
    source: 'fs_watcher',
    severity: 'high',
    rule_id: 'cred.aws-credentials-read',
    rule_name: 'AWS credentials file read',
    path: '/Users/test/.aws/credentials',
    event_kind: 'read',
    identity: {
      pid: 4421,
      process_path: '/usr/local/bin/node',
      argv: ['node'],
      parent_agent_session_id: null,
      ancestry_summary_hash: 'h-abc',
      category: 'agent-subprocess',
    },
    snoozed: false,
    notified: false,
    user_action: 'pending',
    ...overrides,
  };
}

export async function jsonOf(res: Response): Promise<unknown> {
  return res.json();
}
