import { describe, expect, it } from 'vitest';
import { DEFAULT_IDENTITY_ENV_KEYS } from '../src/defaults.js';
import { MockProcessReader } from '../src/proc-mock.js';
import type { RawProcess } from '../src/types.js';
import { walkAncestry } from '../src/walker.js';

function p(overrides: Partial<RawProcess> & { pid: number; ppid: number }): RawProcess {
  return { exe: '', argv: [], env: {}, ...overrides };
}

describe('walkAncestry', () => {
  it('returns the chain root-first (init at index 0, firing last)', async () => {
    const reader = new MockProcessReader([
      p({ pid: 1, ppid: 0, exe: '/sbin/init' }),
      p({ pid: 100, ppid: 1, exe: '/bin/bash' }),
      p({ pid: 4421, ppid: 100, exe: '/usr/local/bin/node' }),
    ]);

    const chain = await walkAncestry(reader, 4421, {
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });

    expect(chain.map(n => n.pid)).toEqual([1, 100, 4421]);
  });

  it('stops at PID 1 / ppid 0', async () => {
    const reader = new MockProcessReader([
      p({ pid: 1, ppid: 0, exe: '/sbin/init' }),
      p({ pid: 2, ppid: 1 }),
    ]);
    const chain = await walkAncestry(reader, 2, {
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });
    expect(chain.map(n => n.pid)).toEqual([1, 2]);
  });

  it('returns empty when the firing pid does not exist', async () => {
    const reader = new MockProcessReader([]);
    expect(
      await walkAncestry(reader, 999, { identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS }),
    ).toEqual([]);
  });

  it('detects and breaks parent cycles', async () => {
    const reader = new MockProcessReader([
      p({ pid: 10, ppid: 20 }),
      p({ pid: 20, ppid: 10 }),
    ]);
    const chain = await walkAncestry(reader, 10, {
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });
    expect(chain.map(n => n.pid).sort()).toEqual([10, 20]);
  });

  it('respects maxDepth even when ppid chain is longer', async () => {
    const reader = new MockProcessReader([
      p({ pid: 1, ppid: 0 }),
      p({ pid: 2, ppid: 1 }),
      p({ pid: 3, ppid: 2 }),
      p({ pid: 4, ppid: 3 }),
    ]);
    const chain = await walkAncestry(reader, 4, {
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
      maxDepth: 2,
    });
    expect(chain).toHaveLength(2);
  });

  it('filters env to identityEnvKeys only', async () => {
    const reader = new MockProcessReader([
      p({
        pid: 1,
        ppid: 0,
        env: { PATH: '/usr/bin', CLAUDE_CODE_SESSION: 'abc', SECRET: 'hidden' },
      }),
    ]);
    const chain = await walkAncestry(reader, 1, {
      identityEnvKeys: new Set(['CLAUDE_CODE_SESSION']),
    });
    expect(chain[0]!.identityEnv).toEqual({ CLAUDE_CODE_SESSION: 'abc' });
  });

  it('stops at first missing process (race condition)', async () => {
    const reader = new MockProcessReader([
      p({ pid: 3, ppid: 99 }), // 99 missing
    ]);
    const chain = await walkAncestry(reader, 3, {
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });
    expect(chain.map(n => n.pid)).toEqual([3]);
  });
});
