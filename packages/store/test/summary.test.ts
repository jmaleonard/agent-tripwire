import type { TripwireEvent } from '@tripwire/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DbHandle } from '../src/db.js';
import { EventRepository } from '../src/events.js';
import { IoCRepository } from '../src/iocs.js';
import { MetaRepository } from '../src/meta.js';
import { SnoozeRepository } from '../src/snooze.js';
import { computeSummary } from '../src/summary.js';

const NOW = new Date('2026-06-07T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function ev(overrides: Partial<TripwireEvent> & { event_id: string }): TripwireEvent {
  return {
    timestamp: NOW.toISOString(),
    source: 'fs_watcher',
    severity: 'high',
    rule_id: 'cred.aws-credentials-read',
    identity: {
      pid: 1,
      process_path: '/usr/bin/node',
      argv: ['node'],
      parent_agent_session_id: null,
      ancestry_summary_hash: 'h',
      category: 'agent-subprocess',
    },
    snoozed: false,
    notified: false,
    user_action: 'pending',
    ...overrides,
  };
}

describe('computeSummary', () => {
  let db: DbHandle;
  let events: EventRepository;
  let snoozes: SnoozeRepository;
  let iocs: IoCRepository;
  let meta: MetaRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    events = new EventRepository(db);
    snoozes = new SnoozeRepository(db);
    iocs = new IoCRepository(db);
    meta = new MetaRepository(db);
  });

  afterEach(() => closeDb(db));

  it('counts events by severity within the last 24h only', () => {
    events.insert(ev({ event_id: 'a', severity: 'critical' }));
    events.insert(ev({ event_id: 'b', severity: 'high' }));
    events.insert(ev({ event_id: 'c', severity: 'high' }));
    // Older than 24h → excluded.
    events.insert(
      ev({ event_id: 'old', severity: 'high', timestamp: new Date(NOW.getTime() - 2 * DAY_MS).toISOString() }),
    );

    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW });
    expect(s.counts.critical).toBe(1);
    expect(s.counts.high).toBe(2);
    expect(s.total).toBe(3);
  });

  it('limits recent events to recentLimit', () => {
    for (let i = 0; i < 8; i++) {
      events.insert(ev({ event_id: `e${i}`, timestamp: new Date(NOW.getTime() - i * 1000).toISOString() }));
    }
    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW, recentLimit: 3 });
    expect(s.recent).toHaveLength(3);
    expect(s.recent[0]!.event_id).toBe('e0'); // most recent first
  });

  it('surfaces an active "all" snooze over a "this" snooze', () => {
    snoozes.add({
      kind: 'this',
      rule_id: 'r',
      ancestry_hash: 'h',
      expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
      created_at: NOW.toISOString(),
    });
    snoozes.add({
      kind: 'all',
      expires_at: new Date(NOW.getTime() + 120_000).toISOString(),
      created_at: NOW.toISOString(),
    });
    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW });
    expect(s.snoozes.active).toBe(true);
    expect(s.snoozes.kind).toBe('all');
  });

  it('reports the daemon running when the heartbeat is fresh', () => {
    meta.recordHeartbeat(new Date(NOW.getTime() - 10_000));
    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW });
    expect(s.daemon.running).toBe(true);
  });

  it('reports the daemon down when the heartbeat is stale', () => {
    meta.recordHeartbeat(new Date(NOW.getTime() - 10 * 60_000));
    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW });
    expect(s.daemon.running).toBe(false);
  });

  it('reports the daemon down when it has never beaten', () => {
    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW });
    expect(s.daemon.running).toBe(false);
    expect(s.daemon.last_heartbeat).toBeNull();
  });

  it('includes the IoC count', () => {
    iocs.upsert([
      {
        ecosystem: 'npm',
        package: 'node-ipc',
        version_spec: '12.0.1',
        sources: [{ name: 'aikido' }],
        first_seen: NOW.toISOString(),
        last_seen: NOW.toISOString(),
      },
    ]);
    const s = computeSummary({ events, snoozes, iocs, meta }, { now: NOW });
    expect(s.ioc_count).toBe(1);
  });
});
