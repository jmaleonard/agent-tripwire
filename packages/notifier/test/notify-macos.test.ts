import type { TripwireEvent } from '@tripwire/shared';
import { describe, expect, it, vi } from 'vitest';
import { MacosNotifier } from '../src/notify-macos.js';

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

describe('MacosNotifier', () => {
  it('calls terminal-notifier with title + message + open URL', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new MacosNotifier({ exec });
    const ok = await n.notify(makeEvent(), { dashboardUrl: 'http://localhost:7878' });
    expect(ok).toBe(true);

    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0]!;
    expect(cmd).toBe('terminal-notifier');
    expect(args).toContain('-title');
    expect(args).toContain('-message');
    expect(args).toContain('-open');
    const openIdx = (args as string[]).indexOf('-open');
    expect((args as string[])[openIdx + 1]).toBe('http://localhost:7878/events/evt-1');
  });

  it('falls back to osascript when terminal-notifier throws', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === 'terminal-notifier') throw new Error('not found');
      return { stdout: '' };
    });
    const n = new MacosNotifier({ exec });
    expect(await n.notify(makeEvent())).toBe(true);

    const cmds = exec.mock.calls.map(c => c[0]);
    expect(cmds).toEqual(['terminal-notifier', 'osascript']);
  });

  it('prefers the Tripwire native notifier when configured', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new MacosNotifier({
      exec,
      tripwireNotifierPath: '/path/to/TripwireMenubar',
    });
    expect(await n.notify(makeEvent(), { dashboardUrl: 'http://localhost:7878' })).toBe(true);
    expect(exec).toHaveBeenCalledOnce();
    const [cmd, args] = exec.mock.calls[0]!;
    expect(cmd).toBe('/path/to/TripwireMenubar');
    expect(args).toContain('--notify');
    expect(args).toContain('--title');
    expect(args).toContain('--body');
    expect(args).toContain('--severity');
    expect(args).toContain('--id');
    expect(args).toContain('--url');
    expect((args as string[]).includes('http://localhost:7878/events/evt-1')).toBe(true);
  });

  it('falls back from Tripwire notifier → terminal-notifier → osascript', async () => {
    const exec = vi.fn(async (cmd: string) => {
      if (cmd === '/bad/TripwireMenubar') throw new Error('crashed');
      if (cmd === 'terminal-notifier') throw new Error('not installed');
      return { stdout: '' };
    });
    const n = new MacosNotifier({
      exec,
      tripwireNotifierPath: '/bad/TripwireMenubar',
    });
    expect(await n.notify(makeEvent())).toBe(true);
    const cmds = exec.mock.calls.map(c => c[0]);
    expect(cmds).toEqual(['/bad/TripwireMenubar', 'terminal-notifier', 'osascript']);
  });

  it('returns false when osascript also fails', async () => {
    const exec = vi.fn(async () => {
      throw new Error('boom');
    });
    const n = new MacosNotifier({ exec });
    expect(await n.notify(makeEvent())).toBe(false);
  });

  it("with useOsascriptOnly: skips terminal-notifier", async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new MacosNotifier({ exec, useOsascriptOnly: true });
    await n.notify(makeEvent());
    expect(exec.mock.calls[0]![0]).toBe('osascript');
  });

  it('osascript escapes quotes and newlines in the message', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new MacosNotifier({ exec, useOsascriptOnly: true });
    await n.notify(makeEvent({ rule_name: 'rule with "quotes"' }));
    const script = (exec.mock.calls[0]![1] as string[])[1]!;
    expect(script).not.toMatch(/[^\\]"quotes"/);
    expect(script).not.toMatch(/\n/);
  });

  it('drops snoozed events without exec', async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new MacosNotifier({ exec });
    expect(await n.notify(makeEvent({ snoozed: true }))).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it("drops 'low' severity below default threshold", async () => {
    const exec = vi.fn(async () => ({ stdout: '' }));
    const n = new MacosNotifier({ exec });
    expect(await n.notify(makeEvent({ severity: 'low' }))).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });
});
