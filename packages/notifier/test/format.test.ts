import type { TripwireEvent } from '@tripwire/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatEvent } from '../src/format.js';

function makeEvent(overrides: Partial<TripwireEvent> = {}): TripwireEvent {
  return {
    event_id: 'evt-1',
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
      argv: ['node', './x.js'],
      parent_agent_session_id: null,
      ancestry_summary_hash: 'h',
      category: 'package-manager-spawned',
    },
    snoozed: false,
    notified: false,
    user_action: 'pending',
    ...overrides,
  };
}

describe('formatEvent', () => {
  let originalHome: string | undefined;
  beforeEach(() => {
    originalHome = process.env.HOME;
    process.env.HOME = '/Users/test';
  });
  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('title is the rule name with severity prefix on high/critical', () => {
    expect(formatEvent(makeEvent({ severity: 'high' })).title).toBe('⚠️ AWS credentials file read');
    expect(formatEvent(makeEvent({ severity: 'critical' })).title).toBe('🚨 AWS credentials file read');
    expect(formatEvent(makeEvent({ severity: 'medium' })).title).toBe('AWS credentials file read');
  });

  it('falls back to rule_id when rule_name is missing', () => {
    const p = formatEvent(makeEvent({ rule_name: undefined }));
    expect(p.title).toContain('cred.aws-credentials-read');
  });

  it('subtitle uses the human actor phrase from ancestry category', () => {
    const cases: Array<[TripwireEvent['identity']['category'], RegExp]> = [
      ['agent-direct', /coding agent/],
      ['agent-subprocess', /via an agent/],
      ['package-manager-direct', /package manager/],
      ['package-manager-spawned', /package-manager script/],
      ['human-shell', /from your shell/],
    ];
    for (const [category, pattern] of cases) {
      const event = makeEvent();
      event.identity.category = category;
      expect(formatEvent(event).subtitle).toMatch(pattern);
    }
  });

  it("'unknown' subtitle hides the placeholder when identity is synthetic", () => {
    const event = makeEvent();
    event.identity.pid = -1;
    event.identity.process_path = '<unknown>';
    event.identity.category = 'unknown';
    expect(formatEvent(event).subtitle).toBe('by an unknown process');
  });

  it("'unknown' subtitle uses the real proc name when present", () => {
    const event = makeEvent();
    event.identity.category = 'unknown';
    expect(formatEvent(event).subtitle).toBe('by node');
  });

  it("body uses past tense ('read', 'wrote to', etc.)", () => {
    const cases: Array<[TripwireEvent['event_kind'], string]> = [
      ['read', 'read'],
      ['open', 'opened'],
      ['write', 'wrote to'],
      ['create', 'created'],
      ['unlink', 'deleted'],
      ['rename', 'renamed'],
    ];
    for (const [kind, verb] of cases) {
      const p = formatEvent(makeEvent({ event_kind: kind! }));
      expect(p.body).toMatch(new RegExp(`^${verb} `));
    }
  });

  it('compresses $HOME to ~', () => {
    const p = formatEvent(makeEvent({ path: '/Users/test/.aws/credentials' }));
    expect(p.body).toContain('~/.aws/credentials');
    expect(p.body).not.toContain('/Users/test');
  });

  it('strips macOS /private/ prefix for readability', () => {
    const p = formatEvent(makeEvent({ path: '/private/tmp/secret' }));
    expect(p.body).toContain('/tmp/secret');
    expect(p.body).not.toContain('/private/');
  });

  it('NEVER uses future tense', () => {
    const p = formatEvent(makeEvent());
    expect(p.body).not.toMatch(/\bis trying to\b|\bis about to\b|\bwill\b/);
  });

  it('does NOT include rule_id or pid in the body (jargon-free)', () => {
    const p = formatEvent(makeEvent());
    expect(p.body).not.toContain('rule:');
    expect(p.body).not.toContain('cred.aws-credentials-read');
    expect(p.body).not.toContain('pid');
    expect(p.body).not.toContain('ancestry:');
  });

  it('appends IoC attribution as a separate body segment with the campaign name', () => {
    const p = formatEvent(
      makeEvent({
        package: {
          ecosystem: 'npm',
          name: 'evil-pkg',
          version: 'unknown',
          ioc_attribution: [{ source: 'aikido', campaign: 'mini-shai-hulud' }],
        },
      }),
    );
    expect(p.body).toContain('evil-pkg flagged by aikido as mini-shai-hulud');
  });

  it('joins multiple IoC sources with /', () => {
    const p = formatEvent(
      makeEvent({
        package: {
          ecosystem: 'npm',
          name: 'p',
          version: 'unknown',
          ioc_attribution: [
            { source: 'aikido', campaign: 'c' },
            { source: 'osv' },
          ],
        },
      }),
    );
    expect(p.body).toMatch(/aikido\/osv/);
  });

  it('handles missing path / event_kind gracefully', () => {
    const p = formatEvent(makeEvent({ path: undefined, event_kind: undefined }));
    expect(p.body).toContain('<unknown path>');
    expect(p.body).toMatch(/^touched /);
  });
});
