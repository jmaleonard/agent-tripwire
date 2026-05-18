import { describe, expect, it } from 'vitest';
import { ancestrySummaryHash } from '../src/hash.js';
import type { Ancestry } from '../src/types.js';

function chain(parts: ReadonlyArray<{ exe: string; argv0?: string }>): Ancestry {
  return parts.map((p, i) => ({
    pid: 1000 + i,
    exe: p.exe,
    argv: p.argv0 !== undefined ? [p.argv0] : [],
    identityEnv: {},
  }));
}

describe('ancestrySummaryHash', () => {
  it('is deterministic for the same chain', () => {
    const a = chain([{ exe: '/bin/bash' }, { exe: '/usr/local/bin/node', argv0: 'node' }]);
    const b = chain([{ exe: '/bin/bash' }, { exe: '/usr/local/bin/node', argv0: 'node' }]);
    expect(ancestrySummaryHash(a)).toBe(ancestrySummaryHash(b));
  });

  it('differs when exe differs', () => {
    const a = chain([{ exe: '/bin/bash' }]);
    const b = chain([{ exe: '/bin/zsh' }]);
    expect(ancestrySummaryHash(a)).not.toBe(ancestrySummaryHash(b));
  });

  it('differs when argv[0] differs', () => {
    const a = chain([{ exe: '/usr/local/bin/node', argv0: 'node' }]);
    const b = chain([{ exe: '/usr/local/bin/node', argv0: 'node-debug' }]);
    expect(ancestrySummaryHash(a)).not.toBe(ancestrySummaryHash(b));
  });

  it('ignores argv beyond argv[0]', () => {
    const baseA: Ancestry = [
      { pid: 1, exe: '/usr/local/bin/node', argv: ['node', './a.js'], identityEnv: {} },
    ];
    const baseB: Ancestry = [
      { pid: 1, exe: '/usr/local/bin/node', argv: ['node', './b.js'], identityEnv: {} },
    ];
    expect(ancestrySummaryHash(baseA)).toBe(ancestrySummaryHash(baseB));
  });

  it('ignores pid (so same tree across restarts still hashes the same)', () => {
    const a: Ancestry = [{ pid: 100, exe: '/bin/bash', argv: ['bash'], identityEnv: {} }];
    const b: Ancestry = [{ pid: 999, exe: '/bin/bash', argv: ['bash'], identityEnv: {} }];
    expect(ancestrySummaryHash(a)).toBe(ancestrySummaryHash(b));
  });

  it('chain order matters (reversed chain hashes differently)', () => {
    const a = chain([{ exe: '/a' }, { exe: '/b' }]);
    const b = chain([{ exe: '/b' }, { exe: '/a' }]);
    expect(ancestrySummaryHash(a)).not.toBe(ancestrySummaryHash(b));
  });

  it('empty ancestry produces SHA-256 of empty input', () => {
    expect(ancestrySummaryHash([])).toMatch(/^[a-f0-9]{64}$/);
  });
});
