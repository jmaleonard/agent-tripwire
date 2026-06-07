import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, openDb, type DbHandle } from '../src/db.js';
import { MetaRepository } from '../src/meta.js';

describe('MetaRepository', () => {
  let db: DbHandle;
  let meta: MetaRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    meta = new MetaRepository(db);
  });

  afterEach(() => closeDb(db));

  it('returns null for an unset key', () => {
    expect(meta.get('nope')).toBeNull();
  });

  it('sets and gets a value', () => {
    meta.set('k', 'v');
    expect(meta.get('k')).toBe('v');
  });

  it('overwrites an existing key', () => {
    meta.set('k', 'v1');
    meta.set('k', 'v2');
    expect(meta.get('k')).toBe('v2');
  });

  it('records and reads the daemon heartbeat', () => {
    const now = new Date('2026-06-07T12:00:00.000Z');
    expect(meta.getHeartbeat()).toBeNull();
    meta.recordHeartbeat(now);
    expect(meta.getHeartbeat()).toBe(now.toISOString());
  });
});
