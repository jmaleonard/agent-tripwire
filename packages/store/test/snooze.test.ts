import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DbHandle } from '../src/db.js';
import { openDb } from '../src/db.js';
import { SnoozeRepository } from '../src/snooze.js';

describe('SnoozeRepository', () => {
  let db: DbHandle;
  let repo: SnoozeRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new SnoozeRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('add returns the row with id', () => {
    const got = repo.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(got.id).toBeGreaterThan(0);
    expect(got.kind).toBe('all');
  });

  it('listActive returns only unexpired entries', () => {
    const now = new Date('2026-05-17T12:30:00.000Z');
    repo.add({
      kind: 'all',
      expires_at: '2026-05-17T12:00:00.000Z',
      created_at: '2026-05-17T11:00:00.000Z',
    });
    repo.add({
      kind: 'this',
      rule_id: 'r',
      ancestry_hash: 'h',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    const active = repo.listActive(now);
    expect(active).toHaveLength(1);
    expect(active[0]?.kind).toBe('this');
  });

  it('isSnoozed returns true for any input when an all-snooze is active', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    repo.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T11:00:00.000Z',
    });
    expect(repo.isSnoozed({ ruleId: 'anything', ancestryHash: 'anything', now })).toBe(true);
  });

  it('isSnoozed scopes this-snoozes to rule + ancestry tuple', () => {
    const now = new Date('2026-05-17T12:00:00.000Z');
    repo.add({
      kind: 'this',
      rule_id: 'cred.aws',
      ancestry_hash: 'abc123',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T11:00:00.000Z',
    });
    expect(repo.isSnoozed({ ruleId: 'cred.aws', ancestryHash: 'abc123', now })).toBe(true);
    expect(repo.isSnoozed({ ruleId: 'cred.aws', ancestryHash: 'other', now })).toBe(false);
    expect(repo.isSnoozed({ ruleId: 'cred.ssh', ancestryHash: 'abc123', now })).toBe(false);
  });

  it('isSnoozed returns false when the snooze has expired', () => {
    repo.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    const past = new Date('2026-05-17T13:30:00.000Z');
    expect(repo.isSnoozed({ ruleId: 'r', ancestryHash: 'h', now: past })).toBe(false);
  });

  it('clear with id removes only that snooze', () => {
    const s1 = repo.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    const s2 = repo.add({
      kind: 'this',
      rule_id: 'r',
      ancestry_hash: 'h',
      expires_at: '2026-05-17T14:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(repo.clear(s1.id!)).toBe(1);
    expect(repo.list().map(s => s.id)).toEqual([s2.id]);
  });

  it('clear without id wipes everything', () => {
    repo.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    repo.add({
      kind: 'this',
      rule_id: 'r',
      ancestry_hash: 'h',
      expires_at: '2026-05-17T14:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(repo.clear()).toBe(2);
    expect(repo.list()).toEqual([]);
  });

  it('purgeExpired only removes expired entries', () => {
    repo.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    repo.add({
      kind: 'all',
      expires_at: '2026-05-17T14:00:00.000Z',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(repo.purgeExpired(new Date('2026-05-17T13:30:00.000Z'))).toBe(1);
    expect(repo.list()).toHaveLength(1);
  });
});
