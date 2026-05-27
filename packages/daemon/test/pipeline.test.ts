import { createLogger, type Rule } from '@tripwire/shared';
import { Engine } from '@tripwire/engine';
import {
  DEFAULT_CLASSIFIER_CONFIG,
  DEFAULT_IDENTITY_ENV_KEYS,
  MockProcessReader,
  type ClassifierConfig,
} from '@tripwire/identity';
import { MockNotifier } from '@tripwire/notifier';
import {
  AllowlistRepository,
  EventRepository,
  IoCRepository,
  openDb,
  SnoozeRepository,
  type DbHandle,
} from '@tripwire/store';
import type { FsEvent } from '@tripwire/watcher';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleFsEvent, type PipelineDeps } from '../src/pipeline.js';

const HOME = '/Users/test';
const CRED_AWS_RULE: Rule = {
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
    argv: ['node', './tool.js'],
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

describe('handleFsEvent', () => {
  let db: DbHandle;
  let events: EventRepository;
  let snoozes: SnoozeRepository;
  let allowlist: AllowlistRepository;
  let iocs: IoCRepository;
  let notifier: MockNotifier;
  let reader: MockProcessReader;
  let engine: Engine;
  let deps: PipelineDeps;
  const classifierConfig: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    events = new EventRepository(db);
    snoozes = new SnoozeRepository(db);
    allowlist = new AllowlistRepository(db);
    iocs = new IoCRepository(db);
    notifier = new MockNotifier();
    reader = new MockProcessReader(AGENT_TREE);
    engine = new Engine({ rules: [CRED_AWS_RULE], allowlist, snoozes, iocs });
    deps = {
      engine,
      events,
      notifier,
      processReader: reader,
      classifierConfig,
      identityEnvKeys: DEFAULT_IDENTITY_ENV_KEYS,
      logger: createLogger({ level: 'silent' }),
      home: HOME,
    };
  });

  afterEach(() => {
    db.close();
  });

  it('full pipeline: emit event → store + notify', async () => {
    const out = await handleFsEvent(deps, makeFsEvent());
    expect(out).toHaveLength(1);
    expect(out[0]!.identity.category).toBe('agent-subprocess');
    expect(out[0]!.rule_id).toBe('cred.aws-credentials-read');
    expect(notifier.sent).toHaveLength(1);
    // Stored AND marked notified
    const stored = events.getById(out[0]!.event_id);
    expect(stored).not.toBeNull();
    expect(stored?.notified).toBe(true);
  });

  it('snoozed events: still stored, NOT notified (spec §6.7.3)', async () => {
    snoozes.add({
      kind: 'all',
      // Far-future expires_at so the snooze is unambiguously active.
      expires_at: '2099-01-01T00:00:00.000Z',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const out = await handleFsEvent(deps, makeFsEvent());
    expect(out).toHaveLength(1);
    expect(out[0]!.snoozed).toBe(true);
    expect(notifier.sent).toEqual([]);
    expect(notifier.skipped[0]?.reason).toBe('snoozed');
    // Still in the DB
    expect(events.getById(out[0]!.event_id)).not.toBeNull();
  });

  it("'low' severity does not notify under default threshold", async () => {
    const lowRule: Rule = { ...CRED_AWS_RULE, id: 'cred.low-test', severity: 'low' };
    engine = new Engine({ rules: [lowRule], allowlist, snoozes, iocs });
    deps = { ...deps, engine };
    const out = await handleFsEvent(deps, makeFsEvent());
    expect(out).toHaveLength(1);
    expect(notifier.skipped[0]?.reason).toBe('below-threshold');
  });

  it('allowlist match: event is suppressed entirely (not stored, not notified)', async () => {
    allowlist.add({
      scope: 'rule',
      rule_id: 'cred.aws-credentials-read',
      created_at: '2026-05-26T11:00:00.000Z',
    });
    const out = await handleFsEvent(deps, makeFsEvent());
    expect(out).toEqual([]);
    expect(notifier.sent).toEqual([]);
    expect(events.list()).toEqual([]);
  });

  it('pid=null events are dropped silently', async () => {
    const out = await handleFsEvent(deps, makeFsEvent({ pid: null }));
    expect(out).toEqual([]);
    expect(events.list()).toEqual([]);
  });

  it('process gone before identify: dropped, no crash', async () => {
    const out = await handleFsEvent(deps, makeFsEvent({ pid: 99999 }));
    expect(out).toEqual([]);
  });

  it('notifier failure does NOT prevent storage (dashboard log is the source of truth)', async () => {
    const flakyNotifier = {
      notify: async () => {
        throw new Error('macOS notifications disabled');
      },
    };
    deps = { ...deps, notifier: flakyNotifier };
    const out = await handleFsEvent(deps, makeFsEvent());
    expect(out).toHaveLength(1);
    // Stored, just not marked notified
    const stored = events.getById(out[0]!.event_id);
    expect(stored?.notified).toBe(false);
  });

  it('IoC enrichment flows through to the stored event', async () => {
    iocs.upsert([
      {
        ecosystem: 'npm',
        package: 'evil-pkg',
        version_spec: '1.0.0',
        sources: [{ name: 'aikido' }],
        campaign: 'mini-shai-hulud',
        first_seen: '2026-05-14T12:00:00.000Z',
        last_seen: '2026-05-14T12:00:00.000Z',
      },
    ]);
    // Override the firing process so it lives in node_modules/evil-pkg/
    reader.add({
      pid: 4421,
      ppid: 100,
      exe: '/project/node_modules/evil-pkg/dist/cli.js',
      argv: ['node', '/project/node_modules/evil-pkg/dist/cli.js'],
      env: {},
    });
    const out = await handleFsEvent(deps, makeFsEvent());
    expect(out[0]!.package?.name).toBe('evil-pkg');
    expect(out[0]!.package?.ioc_attribution?.[0]?.campaign).toBe('mini-shai-hulud');
  });
});
