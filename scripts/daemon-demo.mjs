// Daemon demo: spins up tripwired with MockFsWatcher + MockProcessReader,
// emits a synthetic credential-read event, prints the stored result, and exits.
// Uses an in-memory store, so it's self-contained (it doesn't touch your real
// ~/.tripwire). There's no server — inspection in real use is `tripwire tui`.
//
// What you should see:
//   - A macOS notification banner: "HIGH — AWS credentials file read"
//   - The pipeline result printed below (rule, severity, category, notified)
//
//   node scripts/daemon-demo.mjs

import { homedir } from 'node:os';
import { Daemon } from '../packages/daemon/dist/index.js';
import { MockProcessReader } from '../packages/identity/dist/index.js';
import { MockFsWatcher } from '../packages/watcher/dist/index.js';

const HOME = homedir();
const watcher = new MockFsWatcher();
const reader = new MockProcessReader([
  { pid: 1, ppid: 0, exe: '/sbin/launchd', argv: ['launchd'], env: {} },
  {
    pid: 100, ppid: 1,
    exe: '/Applications/Claude.app/Contents/MacOS/claude',
    argv: ['claude'],
    env: { CLAUDE_CODE_SESSION: 'demo-session' },
  },
  {
    pid: 4421, ppid: 100,
    exe: '/usr/local/bin/node',
    argv: ['node', './suspicious-tool.js'],
    env: { CLAUDE_CODE_SESSION: 'demo-session' },
  },
]);

const daemon = await Daemon.start({ watcher, processReader: reader });

console.log('tripwired up (in-memory store, no server).');
console.log('Emitting synthetic FsEvent: ~/.aws/credentials read by node (subprocess of claude)…\n');

watcher.emit({
  timestamp: new Date().toISOString(),
  path: `${HOME}/.aws/credentials`,
  kind: 'read',
  pid: 4421,
});

await daemon.waitIdle();

const events = daemon.events.list();
console.log(`Pipeline result: ${events.length} event stored.`);
if (events[0]) {
  console.log(`  rule:     ${events[0].rule_id}`);
  console.log(`  severity: ${events[0].severity}`);
  console.log(`  category: ${events[0].identity.category}`);
  console.log(`  notified: ${events[0].notified}`);
}

await daemon.stop();
process.exit(0);
