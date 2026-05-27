// Daemon demo: spins up tripwired with MockFsWatcher + MockProcessReader,
// emits a synthetic credential-read event, and exits after letting the
// notification + dashboard catch up.
//
// What you should see:
//   - A macOS notification banner: "HIGH — AWS credentials file read"
//   - http://localhost:7878/api/summary reflecting the event
//   - The Tripwire Menubar app's icon flipping (within ~5s of its poll)
//
//   node scripts/daemon-demo.mjs
//   ^C to stop. (Or wait — it auto-exits 20s in.)

import { Daemon } from '../packages/daemon/dist/index.js';
import { MockFsWatcher } from '../packages/watcher/dist/index.js';
import { MockProcessReader } from '../packages/identity/dist/index.js';
import { homedir } from 'node:os';

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

const daemon = await Daemon.start({
  watcher,
  processReader: reader,
  dashboardPort: 7878,
});

console.log('tripwired up.');
console.log('  Dashboard: http://localhost:7878');
console.log('  Menubar app should reflect events within 5s.');
console.log('');
console.log('Emitting synthetic FsEvent: ~/.aws/credentials read by node (subprocess of claude)…');

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
  console.log(`  rule:        ${events[0].rule_id}`);
  console.log(`  severity:    ${events[0].severity}`);
  console.log(`  category:    ${events[0].identity.category}`);
  console.log(`  notified:    ${events[0].notified}`);
}

console.log('');
console.log('Leaving daemon up for 20s so you can poke around the dashboard…');
setTimeout(async () => {
  await daemon.stop();
  console.log('Stopped.');
  process.exit(0);
}, 20_000);

const shutdown = async () => {
  await daemon.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
