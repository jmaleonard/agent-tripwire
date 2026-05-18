import type { TripwireEvent } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
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
  it('writes the title with severity and rule name', () => {
    const p = formatEvent(makeEvent());
    expect(p.title).toBe('tripwire: HIGH — AWS credentials file read');
  });

  it('falls back to rule_id when rule_name is missing', () => {
    const p = formatEvent(makeEvent({ rule_name: undefined }));
    expect(p.title).toContain('cred.aws-credentials-read');
  });

  it("body uses past tense: 'just read'", () => {
    const p = formatEvent(makeEvent({ event_kind: 'read' }));
    expect(p.body).toMatch(/node \(pid 4421\) just read \/Users\/test\/\.aws\/credentials/);
  });

  it('maps each event_kind to its past-tense form', () => {
    const verbs: Array<[TripwireEvent['event_kind'], string]> = [
      ['read', 'just read'],
      ['open', 'just opened'],
      ['write', 'just wrote to'],
      ['create', 'just created'],
      ['unlink', 'just deleted'],
      ['rename', 'just renamed'],
    ];
    for (const [kind, verb] of verbs) {
      const p = formatEvent(makeEvent({ event_kind: kind! }));
      expect(p.body).toContain(verb);
    }
  });

  it('NEVER uses future tense', () => {
    const p = formatEvent(makeEvent());
    expect(p.body).not.toMatch(/\bis trying to\b|\bis about to\b|\bwill\b/);
  });

  it('includes the rule id and ancestry category', () => {
    const p = formatEvent(makeEvent());
    expect(p.body).toContain('rule: cred.aws-credentials-read');
    expect(p.body).toContain('ancestry: package-manager-spawned');
  });

  it('formats the package line with version when known', () => {
    const p = formatEvent(
      makeEvent({
        package: { ecosystem: 'npm', name: 'some-pkg', version: '1.2.3' },
      }),
    );
    expect(p.body).toContain('package: some-pkg@1.2.3');
  });

  it("omits the version when it's 'unknown'", () => {
    const p = formatEvent(
      makeEvent({
        package: { ecosystem: 'npm', name: 'some-pkg', version: 'unknown' },
      }),
    );
    expect(p.body).toContain('package: some-pkg\n');
    expect(p.body).not.toContain('@unknown');
  });

  it('adds IoC attribution to the package line', () => {
    const p = formatEvent(
      makeEvent({
        package: {
          ecosystem: 'npm',
          name: 'some-pkg',
          version: 'unknown',
          ioc_attribution: [{ source: 'aikido', campaign: 'mini-shai-hulud' }],
        },
      }),
    );
    expect(p.body).toContain('flagged by aikido as mini-shai-hulud');
  });

  it('joins multiple IoC sources but uses one campaign', () => {
    const p = formatEvent(
      makeEvent({
        package: {
          ecosystem: 'npm',
          name: 'p',
          version: 'unknown',
          ioc_attribution: [
            { source: 'aikido', campaign: 'camp-a' },
            { source: 'osv' },
          ],
        },
      }),
    );
    expect(p.body).toMatch(/flagged by aikido, osv as camp-a/);
  });

  it('builds openUrl from dashboardUrl + event_id', () => {
    const p = formatEvent(makeEvent(), { dashboardUrl: 'http://localhost:7878' });
    expect(p.openUrl).toBe('http://localhost:7878/events/evt-1');
  });

  it('strips trailing slash from dashboardUrl', () => {
    const p = formatEvent(makeEvent(), { dashboardUrl: 'http://localhost:7878/' });
    expect(p.openUrl).toBe('http://localhost:7878/events/evt-1');
  });

  it('omits openUrl when dashboardUrl is not provided', () => {
    expect(formatEvent(makeEvent()).openUrl).toBeUndefined();
  });

  it('handles missing path / event_kind gracefully', () => {
    const p = formatEvent(makeEvent({ path: undefined, event_kind: undefined }));
    expect(p.body).toContain('<unknown path>');
    expect(p.body).toContain('touched (touched)');
  });
});
