import type { TripwireEvent } from '@tripwire/shared';
import { describe, expect, it, vi } from 'vitest';
import { LinuxNotifier } from '../src/notify-linux.js';

function makeEvent(overrides: Partial<TripwireEvent> = {}): TripwireEvent {
  return {
    event_id: 'evt-1',
    timestamp: '2026-05-17T12:00:00.000Z',
    source: 'fs_watcher',
    severity: 'high',
    rule_id: 'cred.aws-credentials-read',
    rule_name: 'AWS credentials file read',
    path: '/home/test/.aws/credentials',
    event_kind: 'read',
    identity: {
      pid: 1,
      process_path: '/usr/bin/node',
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

describe('LinuxNotifier', () => {
  it('calls notify-send with app-name, urgency, icon, title, body', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new LinuxNotifier({ exec });
    expect(await n.notify(makeEvent())).toBe(true);

    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0]!;
    expect(cmd).toBe('notify-send');
    expect(args).toContain('--app-name=tripwire');
    expect(args).toContain('--urgency=normal');
    expect(args).toContain('--icon=dialog-warning');
    // Title is the rule name (no "tripwire:" jargon prefix), with a ⚠️ for high.
    expect((args as string[]).some(a => /AWS credentials file read/.test(a))).toBe(true);
  });

  it('maps severity → urgency correctly', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new LinuxNotifier({ exec });
    const cases: Array<[TripwireEvent['severity'], string]> = [
      ['critical', '--urgency=critical'],
      ['high', '--urgency=normal'],
      ['medium', '--urgency=normal'],
    ];
    for (const [sev, expected] of cases) {
      exec.mockClear();
      await n.notify(makeEvent({ severity: sev }));
      expect(exec.mock.calls[0]![1]).toContain(expected);
    }
  });

  it('returns false when notify-send fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('no notification daemon');
    });
    const n = new LinuxNotifier({ exec });
    expect(await n.notify(makeEvent())).toBe(false);
  });

  it('drops snoozed events without exec', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new LinuxNotifier({ exec });
    expect(await n.notify(makeEvent({ snoozed: true }))).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it("drops 'low' severity below default threshold", async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new LinuxNotifier({ exec });
    expect(await n.notify(makeEvent({ severity: 'low' }))).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('respects a custom minSeverity', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new LinuxNotifier({ exec });
    expect(
      await n.notify(makeEvent({ severity: 'high' }), { minSeverity: 'critical' }),
    ).toBe(false);
    expect(exec).not.toHaveBeenCalled();
    expect(
      await n.notify(makeEvent({ severity: 'critical' }), { minSeverity: 'critical' }),
    ).toBe(true);
  });
});
