import { describe, expect, it } from 'vitest';
import { DEFAULT_CLASSIFIER_CONFIG, DEFAULT_IDENTITY_ENV_KEYS } from '../src/defaults.js';
import { identify } from '../src/identify.js';
import { MockProcessReader } from '../src/proc-mock.js';
import type { RawProcess } from '../src/types.js';

function p(overrides: Partial<RawProcess> & { pid: number; ppid: number }): RawProcess {
  return { exe: '', argv: [], env: {}, ...overrides };
}

describe('identify', () => {
  it('builds a full ProcessIdentity for a package-manager-spawned tree', async () => {
    const reader = new MockProcessReader([
      p({ pid: 1, ppid: 0, exe: '/sbin/init', argv: ['/sbin/init'] }),
      p({ pid: 100, ppid: 1, exe: '/bin/bash', argv: ['bash', '-c', 'npm install'] }),
      p({ pid: 200, ppid: 100, exe: '/usr/local/bin/npm', argv: ['npm', 'install'] }),
      p({ pid: 4421, ppid: 200, exe: '/usr/local/bin/node', argv: ['node', './postinstall.js'] }),
    ]);

    const identity = await identify(4421, {
      reader,
      config: DEFAULT_CLASSIFIER_CONFIG,
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });

    expect(identity).not.toBeNull();
    expect(identity!.pid).toBe(4421);
    expect(identity!.process_path).toBe('/usr/local/bin/node');
    expect(identity!.argv).toEqual(['node', './postinstall.js']);
    expect(identity!.category).toBe('package-manager-spawned');
    expect(identity!.parent_agent_session_id).toBeNull();
    expect(identity!.ancestry_summary_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(identity!.ancestry_summary).toEqual([
      '/sbin/init|/sbin/init',
      '/bin/bash|bash',
      '/usr/local/bin/npm|npm',
      '/usr/local/bin/node|node',
    ]);
  });

  it('returns null when the firing pid does not exist', async () => {
    const reader = new MockProcessReader([]);
    const identity = await identify(9999, {
      reader,
      config: DEFAULT_CLASSIFIER_CONFIG,
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });
    expect(identity).toBeNull();
  });

  it('captures parent_agent_session_id from env markers', async () => {
    const reader = new MockProcessReader([
      p({ pid: 1, ppid: 0, exe: '/sbin/init' }),
      p({
        pid: 50,
        ppid: 1,
        exe: '/Applications/Claude.app/Contents/MacOS/claude-code',
        argv: ['claude-code'],
        env: { CLAUDE_CODE_SESSION: 'sess-xyz' },
      }),
      p({
        pid: 100,
        ppid: 50,
        exe: '/usr/local/bin/node',
        argv: ['node', './tool.js'],
        env: { CLAUDE_CODE_SESSION: 'sess-xyz' }, // inherited
      }),
    ]);

    const identity = await identify(100, {
      reader,
      config: DEFAULT_CLASSIFIER_CONFIG,
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    });

    expect(identity!.category).toBe('agent-subprocess');
    expect(identity!.parent_agent_session_id).toBe('sess-xyz');
  });

  it('hash is stable across different argv beyond argv[0]', async () => {
    const seed = (suffix: string) =>
      new MockProcessReader([
        p({ pid: 1, ppid: 0, exe: '/sbin/init', argv: ['init'] }),
        p({ pid: 2, ppid: 1, exe: '/bin/bash', argv: ['bash'] }),
        p({ pid: 3, ppid: 2, exe: '/usr/local/bin/node', argv: ['node', suffix] }),
      ]);

    const opts = {
      config: DEFAULT_CLASSIFIER_CONFIG,
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
    };
    const a = await identify(3, { reader: seed('./a.js'), ...opts });
    const b = await identify(3, { reader: seed('./b.js'), ...opts });
    expect(a!.ancestry_summary_hash).toBe(b!.ancestry_summary_hash);
  });
});
