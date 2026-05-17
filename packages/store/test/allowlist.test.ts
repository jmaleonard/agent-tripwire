import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllowlistRepository } from '../src/allowlist.js';
import type { DbHandle } from '../src/db.js';
import { openDb } from '../src/db.js';

describe('AllowlistRepository', () => {
  let db: DbHandle;
  let repo: AllowlistRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new AllowlistRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('add returns the entry with an id', () => {
    const got = repo.add({
      scope: 'rule',
      rule_id: 'cred.aws',
      created_at: '2026-05-17T12:00:00.000Z',
      reason: 'AWS CLI is fine',
    });
    expect(got.id).toBeGreaterThan(0);
  });

  it('list and remove', () => {
    const got = repo.add({
      scope: 'rule',
      rule_id: 'cred.aws',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(repo.list()).toHaveLength(1);
    expect(repo.remove(got.id!)).toBe(true);
    expect(repo.list()).toEqual([]);
  });

  it('remove returns false for missing id', () => {
    expect(repo.remove(9999)).toBe(false);
  });

  it("scope 'rule' matches any input with the same rule id", () => {
    repo.add({
      scope: 'rule',
      rule_id: 'cred.aws',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    const match = repo.matches({
      ruleId: 'cred.aws',
      ancestryHash: 'anything',
      processPath: '/anything',
      path: '/home/test/.aws/credentials',
    });
    expect(match?.scope).toBe('rule');
  });

  it("scope 'rule+ancestry' matches only the same ancestry hash", () => {
    repo.add({
      scope: 'rule+ancestry',
      rule_id: 'cred.aws',
      ancestry_hash: 'h-123',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(
      repo.matches({ ruleId: 'cred.aws', ancestryHash: 'h-123', processPath: '/x', path: '/y' }),
    ).not.toBeNull();
    expect(
      repo.matches({ ruleId: 'cred.aws', ancestryHash: 'h-OTHER', processPath: '/x', path: '/y' }),
    ).toBeNull();
  });

  it("scope 'rule+process' matches only the same process path", () => {
    repo.add({
      scope: 'rule+process',
      rule_id: 'cred.aws',
      process_path: '/usr/local/bin/aws',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(
      repo.matches({
        ruleId: 'cred.aws',
        ancestryHash: 'h',
        processPath: '/usr/local/bin/aws',
        path: '/y',
      }),
    ).not.toBeNull();
    expect(
      repo.matches({
        ruleId: 'cred.aws',
        ancestryHash: 'h',
        processPath: '/usr/local/bin/other',
        path: '/y',
      }),
    ).toBeNull();
  });

  it('returns null when no entries exist for the rule', () => {
    expect(
      repo.matches({ ruleId: 'cred.aws', ancestryHash: 'h', processPath: '/x', path: '/y' }),
    ).toBeNull();
  });

  it('entries with a different rule_id are ignored even at scope rule', () => {
    repo.add({
      scope: 'rule',
      rule_id: 'cred.ssh',
      created_at: '2026-05-17T12:00:00.000Z',
    });
    expect(
      repo.matches({ ruleId: 'cred.aws', ancestryHash: 'h', processPath: '/x', path: '/y' }),
    ).toBeNull();
  });
});
