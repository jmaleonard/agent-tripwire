import { EventEmitter } from 'node:events';
import type {
  FsErrorListener,
  FsEvent,
  FsEventListener,
  FsWatchOptions,
  FsWatcher,
} from './types.js';

/**
 * A FsWatcher you drive by hand. Used by the engine's tests and the daemon's
 * integration tests, where a synthetic kernel is much easier to reason about
 * than the real one. Also useful in dev mode: `tripwire test-event` injects
 * via this path.
 */
export class MockFsWatcher implements FsWatcher {
  private readonly emitter = new EventEmitter();
  private started = false;
  private options: FsWatchOptions | undefined;
  private abortHandler: (() => void) | undefined;

  async start(opts: FsWatchOptions): Promise<void> {
    if (this.started) {
      throw new Error('MockFsWatcher.start: already started');
    }
    this.started = true;
    this.options = opts;
    if (opts.signal) {
      if (opts.signal.aborted) {
        await this.stop();
        return;
      }
      this.abortHandler = () => {
        void this.stop();
      };
      opts.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.abortHandler && this.options?.signal) {
      this.options.signal.removeEventListener('abort', this.abortHandler);
    }
    this.abortHandler = undefined;
    this.options = undefined;
    this.emitter.removeAllListeners();
  }

  onEvent(listener: FsEventListener): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  onError(listener: FsErrorListener): () => void {
    this.emitter.on('error', listener);
    return () => this.emitter.off('error', listener);
  }

  // -- test/dev helpers --

  /** Synthesize a kernel event. Throws if the watcher hasn't been started. */
  emit(event: FsEvent): void {
    if (!this.started) {
      throw new Error('MockFsWatcher.emit: watcher is not started');
    }
    this.emitter.emit('event', event);
  }

  /** Synthesize an error condition (e.g. dropped events, helper crash). */
  emitError(err: Error): void {
    this.emitter.emit('error', err);
  }

  /** Inspect the options the watcher was started with. */
  get currentOptions(): FsWatchOptions | undefined {
    return this.options;
  }

  get isStarted(): boolean {
    return this.started;
  }
}
