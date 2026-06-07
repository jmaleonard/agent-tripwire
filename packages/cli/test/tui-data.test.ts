import type { TripwireEvent } from '@tripwire/shared';
import {
  AllowlistRepository,
  closeDb,
  EventRepository,
  FeedStateRepository,
  IoCRepository,
  MetaRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CliRepos } from '../src/store.js';
import { allowlistEvent, dismissEvent, loadTuiState, snoozeEvent } from '../src/tui/data.js';

const NOW = new Date('2026-06-07T12:00:00.000Z');

function makeRepos(db: DbHandle): CliRepos {
  return {
    db,
    events: new EventRepository(db),
    snoozes: new SnoozeRepository(db),
    allowlist: new AllowlistRepository(db),
    iocs: new IoCRepository(db),
    feedState: new FeedStateRepository(db),
    meta: new MetaRepository(db),
  };
}

function ev(id: string): TripwireEvent {
  return {
    event_id: id,
    timestamp: NOW.toISOString(),
    source: 'fs_watcher',
    severity: 'high',
    rule_id: 'cred.aws-credentials-read',
    identity: {
      pid: 4421,
      process_path: '/usr/local/bin/node',
      argv: ['node'],
      parent_agent_session_id: null,
      ancestry_summary_hash: 'hash-1',
      category: 'agent-subprocess',
    },
    snoozed: false,
    notified: false,
    user_action: 'pending',
  };
}

describe('tui/data', () => {
  let db: DbHandle;
  let repos: CliRepos;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repos = makeRepos(db);
  });

  afterEach(() => closeDb(db));

  it('loadTuiState returns a summary and the events', () => {
    repos.events.insert(ev('a'));
    const st = loadTuiState(repos, NOW);
    expect(st.events).toHaveLength(1);
    expect(st.summary.counts.high).toBe(1);
  });

  it('allowlistEvent adds a rule+ancestry entry and marks the event', () => {
    repos.events.insert(ev('a'));
    allowlistEvent(repos, ev('a'), NOW);
    const entries = repos.allowlist.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.scope).toBe('rule+ancestry');
    expect(entries[0]!.ancestry_hash).toBe('hash-1');
    expect(repos.events.getById('a')!.user_action).toBe('allowlisted');
  });

  it('snoozeEvent adds an active "this" snooze for the rule+ancestry', () => {
    snoozeEvent(repos, ev('a'), NOW);
    const active = repos.snoozes.listActive(NOW);
    expect(active).toHaveLength(1);
    expect(active[0]!.kind).toBe('this');
    expect(active[0]!.rule_id).toBe('cred.aws-credentials-read');
  });

  it('dismissEvent marks the event dismissed', () => {
    repos.events.insert(ev('a'));
    dismissEvent(repos, ev('a'));
    expect(repos.events.getById('a')!.user_action).toBe('dismissed');
  });
});
