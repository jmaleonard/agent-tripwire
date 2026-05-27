import type { TripwireEvent } from '@tripwire/shared';
import { describe, expect, it } from 'vitest';
import { MockNotifier } from '../src/notify-mock.js';

function makeEvent(overrides: Partial<TripwireEvent> = {}): TripwireEvent {
  return {
    event_id: 'evt-1',
    timestamp: '2026-05-17T12:00:00.000Z',
    source: 'fs_watcher',
    severity: 'high',
    rule_id: 'cred.aws-credentials-read',
    path: '/Users/test/.aws/credentials',
    event_kind: 'read',
    identity: {
      pid: 1,
      process_path: '/node',
      argv: ['node'],
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

describe('MockNotifier', () => {
  it('captures the payload when severity meets threshold', async () => {
    const n = new MockNotifier();
    expect(await n.notify(makeEvent())).toBe(true);
    expect(n.sent).toHaveLength(1);
    // High-severity events get the ⚠️ prefix in the new formatter.
    expect(n.sent[0]!.payload.title).toMatch(/^⚠️ /);
  });

  it('drops snoozed events and records the reason', async () => {
    const n = new MockNotifier();
    expect(await n.notify(makeEvent({ snoozed: true }))).toBe(false);
    expect(n.sent).toEqual([]);
    expect(n.skipped[0]?.reason).toBe('snoozed');
  });

  it("drops 'low' events at default threshold ('medium')", async () => {
    const n = new MockNotifier();
    expect(await n.notify(makeEvent({ severity: 'low' }))).toBe(false);
    expect(n.skipped[0]?.reason).toBe('below-threshold');
  });

  it('respects a custom minSeverity', async () => {
    const n = new MockNotifier();
    expect(await n.notify(makeEvent({ severity: 'medium' }), { minSeverity: 'critical' })).toBe(false);
    expect(await n.notify(makeEvent({ severity: 'critical' }), { minSeverity: 'critical' })).toBe(true);
  });

  it('clears sent + skipped', async () => {
    const n = new MockNotifier();
    await n.notify(makeEvent());
    await n.notify(makeEvent({ severity: 'info' }));
    n.clear();
    expect(n.sent).toEqual([]);
    expect(n.skipped).toEqual([]);
  });
});
