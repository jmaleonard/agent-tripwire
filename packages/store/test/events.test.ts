import type { TripwireEvent } from '@tripwire/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db.js';
import { openDb } from '../src/db.js';
import { EventRepository } from '../src/events.js';

function makeEvent(overrides: Partial<TripwireEvent> = {}): TripwireEvent {
  return {
    event_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    timestamp: '2026-05-17T12:00:00.000Z',
    source: 'fs_watcher',
    severity: 'high',
    rule_id: 'cred.aws-credentials-read',
    rule_name: 'AWS credentials file read',
    path: '/Users/test/.aws/credentials',
    event_kind: 'read',
    identity: {
      pid: 4421,
      process_path: '/usr/local/bin/node',
      argv: ['node', './postinstall.js'],
      parent_agent_session_id: null,
      ancestry_summary_hash: 'abc123',
      category: 'package-manager-spawned',
      ancestry_summary: ['/sbin/init', '/usr/bin/npm', '/bin/bash', '/usr/local/bin/node'],
    },
    user_action: 'pending',
    snoozed: false,
    notified: false,
    ...overrides,
  };
}

describe('EventRepository', () => {
  let db: DbHandle;
  let repo: EventRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new EventRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips an event with full identity', () => {
    const event = makeEvent();
    repo.insert(event);
    expect(repo.getById(event.event_id)).toEqual(event);
  });

  it('returns null for an unknown id', () => {
    expect(repo.getById('nonexistent')).toBeNull();
  });

  it('lists events ordered by timestamp desc', () => {
    repo.insert(makeEvent({ event_id: 'id-1', timestamp: '2026-05-17T12:00:00.000Z' }));
    repo.insert(makeEvent({ event_id: 'id-2', timestamp: '2026-05-17T13:00:00.000Z' }));
    repo.insert(makeEvent({ event_id: 'id-3', timestamp: '2026-05-17T11:00:00.000Z' }));
    const got = repo.list();
    expect(got.map(e => e.event_id)).toEqual(['id-2', 'id-1', 'id-3']);
  });

  it('filters by severity', () => {
    repo.insert(makeEvent({ event_id: 'id-1', severity: 'critical' }));
    repo.insert(makeEvent({ event_id: 'id-2', severity: 'medium' }));
    expect(repo.list({ severity: 'critical' }).map(e => e.event_id)).toEqual(['id-1']);
  });

  it('filters by ancestry hash', () => {
    const e1 = makeEvent({ event_id: 'id-1' });
    e1.identity.ancestry_summary_hash = 'hash-a';
    const e2 = makeEvent({ event_id: 'id-2' });
    e2.identity.ancestry_summary_hash = 'hash-b';
    repo.insert(e1);
    repo.insert(e2);
    expect(repo.list({ ancestryHash: 'hash-a' }).map(e => e.event_id)).toEqual(['id-1']);
  });

  it('filters by ancestry category and rule id', () => {
    repo.insert(makeEvent({ event_id: 'id-1', rule_id: 'cred.aws' }));
    const e2 = makeEvent({ event_id: 'id-2', rule_id: 'cred.ssh' });
    e2.identity.category = 'agent-subprocess';
    repo.insert(e2);

    expect(
      repo.list({ ancestryCategory: 'agent-subprocess' }).map(e => e.event_id),
    ).toEqual(['id-2']);
    expect(repo.list({ ruleId: 'cred.aws' }).map(e => e.event_id)).toEqual(['id-1']);
  });

  it('updates user_action', () => {
    const event = makeEvent();
    repo.insert(event);
    expect(repo.setUserAction(event.event_id, 'allowlisted')).toBe(true);
    expect(repo.getById(event.event_id)?.user_action).toBe('allowlisted');
  });

  it('setUserAction returns false for unknown id', () => {
    expect(repo.setUserAction('missing', 'dismissed')).toBe(false);
  });

  it('marks snoozed and notified flags', () => {
    const event = makeEvent();
    repo.insert(event);
    repo.markSnoozed(event.event_id);
    repo.markNotified(event.event_id);
    const got = repo.getById(event.event_id);
    expect(got?.snoozed).toBe(true);
    expect(got?.notified).toBe(true);
  });

  it('round-trips IoC attribution', () => {
    const event = makeEvent({
      package: {
        ecosystem: 'npm',
        name: 'evil-pkg',
        version: '1.2.3',
        ioc_attribution: [{ source: 'aikido', campaign: 'mini-shai-hulud' }],
      },
    });
    repo.insert(event);
    expect(repo.getById(event.event_id)?.package).toEqual(event.package);
  });

  it('respects limit and offset on list', () => {
    for (let i = 0; i < 5; i++) {
      const ts = `2026-05-17T12:0${i}:00.000Z`;
      repo.insert(makeEvent({ event_id: `id-${i}`, timestamp: ts }));
    }
    const page1 = repo.list({ limit: 2 });
    expect(page1.map(e => e.event_id)).toEqual(['id-4', 'id-3']);
    const page2 = repo.list({ limit: 2, offset: 2 });
    expect(page2.map(e => e.event_id)).toEqual(['id-2', 'id-1']);
  });
});
