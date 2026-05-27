import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createInterface, type Interface } from 'node:readline';
import type {
  FsErrorListener,
  FsEvent,
  FsEventListener,
  FsWatchOptions,
  FsWatcher,
} from './types.js';

export interface NativeFsWatcherOptions {
  /** Path to the tripwire-watcher binary. */
  helperPath: string;
  /** Optional: capture helper stderr lines (for logging). Default: ignored. */
  onStderr?: (line: string) => void;
}

/**
 * Spawns the Rust `tripwire-watcher` helper, pipes the watch config in via
 * stdin, parses JSONL events off stdout, emits them as FsEvents. Errors
 * (parse failure, non-zero exit) go to the error listeners.
 *
 * The helper is the only OS-coupled piece of the watcher; this class is a
 * thin process-supervisor.
 */
export class NativeFsWatcher implements FsWatcher {
  private readonly emitter = new EventEmitter();
  private readonly helperPath: string;
  private readonly onStderr: ((line: string) => void) | undefined;
  private proc: ChildProcess | undefined;
  private stdoutRl: Interface | undefined;
  private stderrRl: Interface | undefined;
  private abortHandler: (() => void) | undefined;
  private currentSignal: AbortSignal | undefined;

  constructor(opts: NativeFsWatcherOptions) {
    this.helperPath = opts.helperPath;
    if (opts.onStderr) this.onStderr = opts.onStderr;
  }

  async start(opts: FsWatchOptions): Promise<void> {
    if (this.proc) throw new Error('NativeFsWatcher.start: already started');

    const proc = spawn(this.helperPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;

    proc.on('error', err => this.emitter.emit('error', err));
    proc.on('exit', (code, signal) => {
      if (code !== 0 && code !== null && signal !== 'SIGTERM' && signal !== 'SIGKILL') {
        this.emitter.emit('error', new Error(`tripwire-watcher exited with code ${code}`));
      }
    });

    this.stdoutRl = createInterface({ input: proc.stdout! });
    this.stdoutRl.on('line', line => this.onStdoutLine(line));

    this.stderrRl = createInterface({ input: proc.stderr! });
    this.stderrRl.on('line', line => {
      if (this.onStderr) this.onStderr(line);
    });

    // Write config + close stdin so the helper begins watching.
    const config = JSON.stringify({
      read_paths: [...opts.read_paths],
      write_paths: [...opts.write_paths],
    });
    proc.stdin!.write(config);
    proc.stdin!.end();

    if (opts.signal) {
      if (opts.signal.aborted) {
        await this.stop();
        return;
      }
      this.currentSignal = opts.signal;
      this.abortHandler = () => {
        void this.stop();
      };
      opts.signal.addEventListener('abort', this.abortHandler, { once: true });
    }
  }

  async stop(): Promise<void> {
    if (this.abortHandler && this.currentSignal) {
      this.currentSignal.removeEventListener('abort', this.abortHandler);
    }
    this.abortHandler = undefined;
    this.currentSignal = undefined;
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = undefined;
    }
    this.stdoutRl?.close();
    this.stderrRl?.close();
    this.stdoutRl = undefined;
    this.stderrRl = undefined;
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

  private onStdoutLine(line: string): void {
    if (line.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      this.emitter.emit('error', new Error(`tripwire-watcher: malformed JSON: ${line.slice(0, 200)}`));
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.timestamp !== 'string' ||
      typeof obj.path !== 'string' ||
      typeof obj.kind !== 'string'
    ) {
      return;
    }
    const event: FsEvent = {
      timestamp: obj.timestamp,
      path: obj.path,
      kind: obj.kind as FsEvent['kind'],
      pid: typeof obj.pid === 'number' ? obj.pid : null,
    };
    this.emitter.emit('event', event);
  }
}
