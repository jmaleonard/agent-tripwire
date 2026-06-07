import { createLogger, type Rule } from '@tripwire/shared';
import { MockProcessReader } from '@tripwire/identity';
import { MockNotifier } from '@tripwire/notifier';
import { MockFsWatcher, type FsEvent } from '@tripwire/watcher';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Daemon } from '../src/daemon.js';

const HOME = '/Users/test';

const RULE: Rule = {
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

const AGENT_TREE = [
  { pid: 1, ppid: 0, exe: '/sbin/init', argv: ['init'], env: {} },
  {
    pid: 100,
    ppid: 1,
    exe: '/Applications/Claude.app/Contents/MacOS/claude-code',
    argv: ['claude-code'],
    env: { CLAUDE_CODE_SESSION: 'sess-x' },
  },
  {
    pid: 4421,
    ppid: 100,
    exe: '/usr/local/bin/node',
    argv: ['node'],
    env: { CLAUDE_CODE_SESSION: 'sess-x' },
  },
];

function makeFsEvent(overrides: Partial<FsEvent> = {}): FsEvent {
  return {
    timestamp: '2026-05-26T12:00:00.000Z',
    path: `${HOME}/.aws/credentials`,
    kind: 'read',
    pid: 4421,
    ...overrides,
  };
}

describe('Daemon', () => {
  let watcher: MockFsWatcher;
  let notifier: MockNotifier;
  let reader: MockProcessReader;
  let daemon: Daemon;

  beforeEach(() => {
    watcher = new MockFsWatcher();
    notifier = new MockNotifier();
    reader = new MockProcessReader(AGENT_TREE);
  });

  afterEach(async () => {
    await daemon?.stop();
  });

  async function startTestDaemon(): Promise<Daemon> {
    return Daemon.start({
      watcher,
      processReader: reader,
      notifier,
      rules: [RULE],
      home: HOME,
      logger: createLogger({ level: 'silent' }),
    });
  }

  it('end-to-end: watcher emit → identify → engine → store + notify', async () => {
    daemon = await startTestDaemon();

    watcher.emit(makeFsEvent());
    await daemon.waitIdle();

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]!.event.identity.category).toBe('agent-subprocess');

    const stored = daemon.events.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.notified).toBe(true);
  });

  it('multiple rapid emits all flow through', async () => {
    daemon = await startTestDaemon();
    for (let i = 0; i < 5; i++) {
      watcher.emit(makeFsEvent({ timestamp: `2026-05-26T12:00:0${i}.000Z` }));
    }
    await daemon.waitIdle();
    expect(daemon.events.list()).toHaveLength(5);
    expect(notifier.sent).toHaveLength(5);
  });

  it("snoozed events go to the DB but not the notifier", async () => {
    daemon = await startTestDaemon();
    daemon.snoozes.add({
      kind: 'all',
      expires_at: '2030-01-01T00:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });

    watcher.emit(makeFsEvent());
    await daemon.waitIdle();

    expect(daemon.events.list()).toHaveLength(1);
    expect(daemon.events.list()[0]!.snoozed).toBe(true);
    expect(notifier.sent).toEqual([]);
  });

  it('engine errors do not crash the loop', async () => {
    daemon = await startTestDaemon();
    // Emit one that succeeds, one with a bogus pid that causes identify->null
    watcher.emit(makeFsEvent());
    watcher.emit(makeFsEvent({ pid: 99999 }));
    watcher.emit(makeFsEvent({ timestamp: '2026-05-26T12:00:01.000Z' }));
    await daemon.waitIdle();
    expect(daemon.events.list()).toHaveLength(2);
  });

  it('stop() awaits inflight pipeline work', async () => {
    daemon = await startTestDaemon();
    watcher.emit(makeFsEvent());
    await daemon.stop();
    // After stop, the event should still have been stored
    expect(notifier.sent).toHaveLength(1);
  });

  it('double start throws', async () => {
    daemon = await startTestDaemon();
    await expect(daemon['initialize']()).rejects.toThrow(/already started/);
  });

  it('writes a liveness heartbeat on start', async () => {
    daemon = await startTestDaemon();
    expect(daemon.meta.getHeartbeat()).not.toBeNull();
  });

  it('multiple daemons can run in the same process (no network surface)', async () => {
    daemon = await startTestDaemon();
    const second = await Daemon.start({
      watcher: new MockFsWatcher(),
      processReader: new MockProcessReader([]),
      notifier: new MockNotifier(),
      rules: [],
      logger: createLogger({ level: 'silent' }),
    });
    await second.stop();
  });
});
