import { describe, expect, it } from 'vitest';
import { classify } from '../src/classifier.js';
import { DEFAULT_CLASSIFIER_CONFIG } from '../src/defaults.js';
import type { Ancestry } from '../src/types.js';

const CFG = DEFAULT_CLASSIFIER_CONFIG;

function chain(parts: ReadonlyArray<{ exe: string; identityEnv?: Record<string, string> }>): Ancestry {
  return parts.map((p, i) => ({
    pid: 1000 + i,
    exe: p.exe,
    argv: [p.exe.split('/').pop()!],
    identityEnv: p.identityEnv ?? {},
  }));
}

describe('classify', () => {
  it('agent-direct: firing process IS a known agent', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/Applications/Claude.app/Contents/MacOS/claude-code' },
    ]);
    expect(classify(c, CFG)).toBe('agent-direct');
  });

  it('agent-subprocess via env marker (firing is generic, marker on ancestor)', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/usr/bin/bash', identityEnv: { CLAUDE_CODE_SESSION: 'abc' } },
      { exe: '/usr/local/bin/node' },
    ]);
    expect(classify(c, CFG)).toBe('agent-subprocess');
  });

  it('agent-subprocess via env marker on the firing process itself', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/usr/local/bin/node', identityEnv: { CLAUDE_CODE_SESSION: 'abc' } },
    ]);
    expect(classify(c, CFG)).toBe('agent-subprocess');
  });

  it('agent-subprocess via agent-path ancestor', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/Applications/Cursor.app/Contents/MacOS/Cursor' },
      { exe: '/usr/local/bin/node' },
    ]);
    expect(classify(c, CFG)).toBe('agent-subprocess');
  });

  it('package-manager-direct: firing process IS a package manager', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/bin/bash' },
      { exe: '/usr/local/bin/npm' },
    ]);
    expect(classify(c, CFG)).toBe('package-manager-direct');
  });

  it('package-manager-spawned: firing is node, ancestor is npm', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/bin/bash' },
      { exe: '/usr/local/bin/npm' },
      { exe: '/usr/local/bin/node' },
    ]);
    expect(classify(c, CFG)).toBe('package-manager-spawned');
  });

  it('precedence: agent-subprocess wins over package-manager-spawned', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/Applications/Claude.app/Contents/MacOS/claude-code' },
      { exe: '/usr/local/bin/npm' },
      { exe: '/usr/local/bin/node' },
    ]);
    expect(classify(c, CFG)).toBe('agent-subprocess');
  });

  it('precedence: agent-direct wins overall', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/usr/local/bin/npm' },
      { exe: '/Applications/Claude.app/Contents/MacOS/claude-code', identityEnv: { CLAUDE_CODE_SESSION: 'x' } },
    ]);
    expect(classify(c, CFG)).toBe('agent-direct');
  });

  it('human-shell: shell in ancestry, no agent/pm anywhere', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/bin/zsh' },
      { exe: '/usr/local/bin/aws' },
    ]);
    expect(classify(c, CFG)).toBe('human-shell');
  });

  it('unknown: nothing matches', () => {
    const c = chain([
      { exe: '/sbin/init' },
      { exe: '/some/weird/launcher' },
      { exe: '/usr/local/bin/mystery-tool' },
    ]);
    expect(classify(c, CFG)).toBe('unknown');
  });

  it('unknown for empty ancestry', () => {
    expect(classify([], CFG)).toBe('unknown');
  });

  it("does not flip into 'spawned' when firing itself is the package manager", () => {
    const c = chain([{ exe: '/sbin/init' }, { exe: '/usr/local/bin/npm' }]);
    expect(classify(c, CFG)).toBe('package-manager-direct');
  });
});
