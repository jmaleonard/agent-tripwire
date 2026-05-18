import type { IoCEntry, ProcessIdentity, Rule } from '@tripwire/shared';
import {
  AllowlistRepository,
  IoCRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../src/engine.js';

const HOME = '/Users/test';
const NOW = new Date('2026-05-17T12:00:00.000Z');

const CRED_AWS_RULE: Rule = {
  id: 'cred.aws-credentials-read',
  name: 'AWS credentials file read',
  severity: 'high',
  category: 'credential-access',
  description: 'A process read ~/.aws/credentials.',
  applies_to: {
    event_kind: ['read'],
    path: { home_relative: ['.aws/credentials'] },
    ancestry_category: { not_in: ['human-shell'] },
  },
};

const PERSIST_CLAUDE_RULE: Rule = {
  id: 'persist.claude-settings-write',
  name: 'Drop of .claude/settings.json',
  severity: 'high',
  category: 'persistence',
  description: 'A non-editor process wrote to .claude/settings.json.',
  applies_to: {
    event_kind: ['write', 'create'],
    path: { glob: ['**/.claude/settings.json'] },
  },
};

function makeEvent(overrides: Partial<FsEvent> = {}): FsEvent {
  return {
    timestamp: NOW.toISOString(),
    path: `${HOME}/.aws/credentials`,
    kind: 'read',
    pid: 4421,
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<ProcessIdentity> = {}): ProcessIdentity {
  return {
    pid: 4421,
    process_path: '/project/node_modules/some-pkg/lib/cli.js',
    argv: ['node', '/project/node_modules/some-pkg/lib/cli.js'],
    parent_agent_session_id: null,
    ancestry_summary_hash: 'hash-firing',
    category: 'package-manager-spawned',
    ...overrides,
  };
}

describe('Engine.evaluate', () => {
  let db: DbHandle;
  let allowlist: AllowlistRepository;
  let snoozes: SnoozeRepository;
  let iocs: IoCRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    allowlist = new AllowlistRepository(db);
    snoozes = new SnoozeRepository(db);
    iocs = new IoCRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeEngine(rules: Rule[]): Engine {
    return new Engine({ rules, allowlist, snoozes, iocs });
  }

  it('fires a rule when applies_to matches', () => {
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(makeEvent(), makeIdentity(), {
      home: HOME,
      now: () => NOW,
      eventId: () => 'fixed-uuid',
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.rule_id).toBe('cred.aws-credentials-read');
    expect(out[0]!.severity).toBe('high');
    expect(out[0]!.event_id).toBe('fixed-uuid');
    expect(out[0]!.snoozed).toBe(false);
    expect(out[0]!.notified).toBe(false);
    expect(out[0]!.user_action).toBe('pending');
  });

  it('does not fire when applies_to fails (different path)', () => {
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(
      makeEvent({ path: `${HOME}/.ssh/id_rsa` }),
      makeIdentity(),
      { home: HOME },
    );
    expect(out).toEqual([]);
  });

  it('suppresses entirely when an allowlist entry matches', () => {
    allowlist.add({
      scope: 'rule+ancestry',
      rule_id: 'cred.aws-credentials-read',
      ancestry_hash: 'hash-firing',
      created_at: NOW.toISOString(),
    });
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(makeEvent(), makeIdentity(), { home: HOME });
    expect(out).toEqual([]);
  });

  it('still fires (with snoozed=true) when a snooze matches', () => {
    snoozes.add({
      kind: 'this',
      rule_id: 'cred.aws-credentials-read',
      ancestry_hash: 'hash-firing',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: NOW.toISOString(),
    });
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(makeEvent(), makeIdentity(), {
      home: HOME,
      now: () => NOW,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.snoozed).toBe(true);
  });

  it("'snooze all' makes every event snoozed", () => {
    snoozes.add({
      kind: 'all',
      expires_at: '2026-05-17T13:00:00.000Z',
      created_at: NOW.toISOString(),
    });
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(makeEvent(), makeIdentity(), {
      home: HOME,
      now: () => NOW,
    });
    expect(out[0]!.snoozed).toBe(true);
  });

  it('attaches package attribution + IoC when the firing exe lives in node_modules', () => {
    const ioc: IoCEntry = {
      ecosystem: 'npm',
      package: 'some-pkg',
      version_spec: '1.0.0',
      sources: [{ name: 'aikido' }],
      campaign: 'mini-shai-hulud',
      first_seen: 'x',
      last_seen: 'x',
    };
    iocs.upsert([ioc]);
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(makeEvent(), makeIdentity(), { home: HOME, now: () => NOW });
    expect(out[0]!.package).toEqual({
      ecosystem: 'npm',
      name: 'some-pkg',
      version: 'unknown',
      ioc_attribution: [{ source: 'aikido', campaign: 'mini-shai-hulud' }],
    });
  });

  it('skips package attribution when the firing exe is not in a package container', () => {
    const engine = makeEngine([CRED_AWS_RULE]);
    const out = engine.evaluate(
      makeEvent(),
      makeIdentity({ process_path: '/usr/local/bin/aws' }),
      { home: HOME, now: () => NOW },
    );
    expect(out[0]!.package).toBeUndefined();
  });

  it('fires multiple events when multiple rules match', () => {
    const engine = makeEngine([CRED_AWS_RULE, PERSIST_CLAUDE_RULE]);
    // First event hits the AWS rule
    const a = engine.evaluate(makeEvent(), makeIdentity(), { home: HOME, now: () => NOW });
    expect(a.map(e => e.rule_id)).toEqual(['cred.aws-credentials-read']);

    // Second event hits the persistence rule
    const b = engine.evaluate(
      makeEvent({
        path: `${HOME}/projects/foo/.claude/settings.json`,
        kind: 'write',
      }),
      makeIdentity(),
      { home: HOME, now: () => NOW },
    );
    expect(b.map(e => e.rule_id)).toEqual(['persist.claude-settings-write']);
  });

  it('skips disabled rules', () => {
    const engine = makeEngine([{ ...CRED_AWS_RULE, disabled: true }]);
    const out = engine.evaluate(makeEvent(), makeIdentity(), { home: HOME });
    expect(out).toEqual([]);
  });

  it('returns empty when no rules match', () => {
    const engine = makeEngine([]);
    expect(engine.evaluate(makeEvent(), makeIdentity(), { home: HOME })).toEqual([]);
  });

  it('respects allowlist scope=rule (whole rule allowlisted regardless of ancestry)', () => {
    allowlist.add({
      scope: 'rule',
      rule_id: 'cred.aws-credentials-read',
      created_at: NOW.toISOString(),
    });
    const engine = makeEngine([CRED_AWS_RULE]);
    expect(engine.evaluate(makeEvent(), makeIdentity({ ancestry_summary_hash: 'other' }), { home: HOME })).toEqual([]);
  });
});
