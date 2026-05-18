import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockFsWatcher } from '../src/mock.js';
import type { FsEvent, FsWatchOptions } from '../src/types.js';

const OPTS: FsWatchOptions = {
  read_paths: ['~/.ssh', '~/.aws'],
  write_paths: ['**/.claude/settings.json'],
};

function makeEvent(overrides: Partial<FsEvent> = {}): FsEvent {
  return {
    timestamp: '2026-05-17T12:00:00.000Z',
    path: '/Users/test/.aws/credentials',
    kind: 'read',
    pid: 4421,
    ...overrides,
  };
}

describe('MockFsWatcher', () => {
  let watcher: MockFsWatcher;

  afterEach(async () => {
    await watcher?.stop();
  });

  it('start arms the watcher; events flow to listeners', async () => {
    watcher = new MockFsWatcher();
    const listener = vi.fn();
    watcher.onEvent(listener);
    await watcher.start(OPTS);

    const event = makeEvent();
    watcher.emit(event);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);
  });

  it('disposer returned from onEvent stops delivering to that listener', async () => {
    watcher = new MockFsWatcher();
    const a = vi.fn();
    const b = vi.fn();
    const disposeA = watcher.onEvent(a);
    watcher.onEvent(b);
    await watcher.start(OPTS);

    watcher.emit(makeEvent());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();

    disposeA();
    watcher.emit(makeEvent());
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledTimes(2);
  });

  it('double-start throws', async () => {
    watcher = new MockFsWatcher();
    await watcher.start(OPTS);
    await expect(watcher.start(OPTS)).rejects.toThrow(/already started/);
  });

  it('emit before start throws', () => {
    watcher = new MockFsWatcher();
    expect(() => watcher.emit(makeEvent())).toThrow(/not started/);
  });

  it('stop clears listeners and is idempotent', async () => {
    watcher = new MockFsWatcher();
    const listener = vi.fn();
    watcher.onEvent(listener);
    await watcher.start(OPTS);

    await watcher.stop();
    await watcher.stop(); // idempotent

    expect(watcher.isStarted).toBe(false);
    // After stop, re-starting is allowed
    await watcher.start(OPTS);
    watcher.emit(makeEvent());
    // The old listener was cleared by stop()
    expect(listener).not.toHaveBeenCalled();
  });

  it('emits errors to error listeners', async () => {
    watcher = new MockFsWatcher();
    const onError = vi.fn();
    watcher.onError(onError);
    await watcher.start(OPTS);

    const err = new Error('dropped 17 events');
    watcher.emitError(err);

    expect(onError).toHaveBeenCalledWith(err);
  });

  it('AbortSignal stops the watcher when fired', async () => {
    watcher = new MockFsWatcher();
    const controller = new AbortController();
    await watcher.start({ ...OPTS, signal: controller.signal });
    expect(watcher.isStarted).toBe(true);

    controller.abort();
    // stop() inside the abort handler is async — let microtasks flush
    await Promise.resolve();
    await Promise.resolve();
    expect(watcher.isStarted).toBe(false);
  });

  it('start with an already-aborted signal does not arm the watcher', async () => {
    watcher = new MockFsWatcher();
    const controller = new AbortController();
    controller.abort();
    await watcher.start({ ...OPTS, signal: controller.signal });
    expect(watcher.isStarted).toBe(false);
  });

  it('currentOptions exposes what the watcher was started with', async () => {
    watcher = new MockFsWatcher();
    await watcher.start(OPTS);
    expect(watcher.currentOptions).toEqual(OPTS);
    await watcher.stop();
    expect(watcher.currentOptions).toBeUndefined();
  });

  it('events with pid=null are passed through (platform gap signal)', async () => {
    watcher = new MockFsWatcher();
    const listener = vi.fn();
    watcher.onEvent(listener);
    await watcher.start(OPTS);

    const event = makeEvent({ pid: null, kind: 'write' });
    watcher.emit(event);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
