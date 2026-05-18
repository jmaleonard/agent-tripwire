import type { ProcessReader, RawProcess } from './types.js';

/**
 * In-memory ProcessReader for tests. Construct with a map of pid → RawProcess
 * or feed processes incrementally via `add`. Returns null for missing pids
 * (simulating dead processes / race conditions).
 */
export class MockProcessReader implements ProcessReader {
  private readonly processes = new Map<number, RawProcess>();

  constructor(initial: ReadonlyArray<RawProcess> = []) {
    for (const p of initial) this.add(p);
  }

  add(p: RawProcess): void {
    this.processes.set(p.pid, { ...p, argv: [...p.argv], env: { ...p.env } });
  }

  remove(pid: number): boolean {
    return this.processes.delete(pid);
  }

  async read(pid: number): Promise<RawProcess | null> {
    const p = this.processes.get(pid);
    return p ? { ...p, argv: [...p.argv], env: { ...p.env } } : null;
  }
}
