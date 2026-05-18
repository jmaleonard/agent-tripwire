import type { PackageRef, ProcessIdentity, Rule } from '@tripwire/shared';
import type { FsEvent } from '@tripwire/watcher';
import { describe, expect, it } from 'vitest';
import { ruleApplies, type RuleMatchInput } from '../src/rule-match.js';

const HOME = '/Users/test';

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'cred.aws-credentials-read',
    name: 'AWS credentials file read',
    severity: 'high',
    category: 'credential-access',
    description: 'A process read ~/.aws/credentials.',
    applies_to: {
      event_kind: ['read'],
      path: { home_relative: ['.aws/credentials', '.aws/config'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
    ...overrides,
  };
}

function makeEvent(overrides: Partial<FsEvent> = {}): FsEvent {
  return {
    timestamp: '2026-05-17T12:00:00.000Z',
    path: `${HOME}/.aws/credentials`,
    kind: 'read',
    pid: 4421,
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<ProcessIdentity> = {}): ProcessIdentity {
  return {
    pid: 4421,
    process_path: '/usr/local/bin/node',
    argv: ['node', './x.js'],
    parent_agent_session_id: null,
    ancestry_summary_hash: 'abc123',
    category: 'package-manager-spawned',
    ...overrides,
  };
}

function input(
  overrides: Partial<RuleMatchInput> = {},
  pkg: PackageRef | null = null,
): RuleMatchInput {
  return {
    event: makeEvent(),
    identity: makeIdentity(),
    package: pkg,
    ...overrides,
  };
}

describe('ruleApplies', () => {
  it('matches when all predicates are satisfied', () => {
    expect(ruleApplies(makeRule(), input(), { home: HOME })).toBe(true);
  });

  it('returns false when the rule is disabled', () => {
    expect(ruleApplies(makeRule({ disabled: true }), input(), { home: HOME })).toBe(false);
  });

  it('event_kind: rejects unmatched kinds', () => {
    const i = input({ event: makeEvent({ kind: 'write' }) });
    expect(ruleApplies(makeRule(), i, { home: HOME })).toBe(false);
  });

  it('path: rejects when path predicate misses', () => {
    const i = input({ event: makeEvent({ path: `${HOME}/.ssh/id_rsa` }) });
    expect(ruleApplies(makeRule(), i, { home: HOME })).toBe(false);
  });

  it("ancestry_category not_in: rejects human-shell when rule excludes it", () => {
    const i = input({ identity: makeIdentity({ category: 'human-shell' }) });
    expect(ruleApplies(makeRule(), i, { home: HOME })).toBe(false);
  });

  it('ancestry_category in: accepts only listed categories', () => {
    const rule = makeRule({
      applies_to: {
        event_kind: ['read'],
        path: { home_relative: ['.aws/credentials'] },
        ancestry_category: { in: ['agent-subprocess'] },
      },
    });
    const a = input({ identity: makeIdentity({ category: 'agent-subprocess' }) });
    const b = input({ identity: makeIdentity({ category: 'package-manager-spawned' }) });
    expect(ruleApplies(rule, a, { home: HOME })).toBe(true);
    expect(ruleApplies(rule, b, { home: HOME })).toBe(false);
  });

  it('ecosystem in: requires a matching package attribution', () => {
    const rule = makeRule({
      applies_to: {
        event_kind: ['read'],
        path: { home_relative: ['.aws/credentials'] },
        ecosystem: { in: ['npm'] },
      },
    });
    const npmPkg: PackageRef = { ecosystem: 'npm', name: 'p', version: '1.0.0' };
    const pyPkg: PackageRef = { ecosystem: 'pypi', name: 'p', version: '1.0.0' };
    expect(ruleApplies(rule, input({}, npmPkg), { home: HOME })).toBe(true);
    expect(ruleApplies(rule, input({}, pyPkg), { home: HOME })).toBe(false);
    expect(ruleApplies(rule, input({}, null), { home: HOME })).toBe(false);
  });

  it('ecosystem not_in: excludes the listed ecosystems', () => {
    const rule = makeRule({
      applies_to: {
        event_kind: ['read'],
        path: { home_relative: ['.aws/credentials'] },
        ecosystem: { not_in: ['pypi'] },
      },
    });
    const npmPkg: PackageRef = { ecosystem: 'npm', name: 'p', version: '1.0.0' };
    const pyPkg: PackageRef = { ecosystem: 'pypi', name: 'p', version: '1.0.0' };
    expect(ruleApplies(rule, input({}, npmPkg), { home: HOME })).toBe(true);
    expect(ruleApplies(rule, input({}, pyPkg), { home: HOME })).toBe(false);
  });

  it('applies when applies_to has no constraints (catch-all)', () => {
    const rule = makeRule({ applies_to: {} });
    expect(ruleApplies(rule, input(), { home: HOME })).toBe(true);
  });
});
