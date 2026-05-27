// Demo runner: seed an :memory: DB with sample events + start the dashboard
// server on http://localhost:7878. Mostly useful for ad-hoc verification of
// the menubar app and the dashboard UI shell.
//
//   node scripts/dashboard-demo.mjs
//
// Ctrl-C to stop.

import {
  AllowlistRepository,
  EventRepository,
  IoCRepository,
  openDb,
  SnoozeRepository,
} from '../packages/store/dist/index.js';
import { startDashboard } from '../packages/dashboard/dist/index.js';

const db = openDb({ path: ':memory:' });
const events = new EventRepository(db);

const ts = (offsetMin) => new Date(Date.now() - offsetMin * 60_000).toISOString();
const baseIdentity = {
  pid: 4421,
  process_path: '/usr/local/bin/node',
  argv: ['node', 'demo.js'],
  parent_agent_session_id: null,
  ancestry_summary_hash: 'demo-hash',
  category: 'agent-subprocess',
};
const baseFields = {
  source: 'fs_watcher',
  identity: baseIdentity,
  snoozed: false,
  notified: false,
  user_action: 'pending',
};

const samples = [
  { event_id: 'evt-1', timestamp: ts(2), severity: 'critical',
    rule_id: 'cred.aws-credentials-read', rule_name: 'AWS credentials file read',
    path: '/Users/jaredleonard/.aws/credentials', event_kind: 'read' },
  { event_id: 'evt-2', timestamp: ts(5), severity: 'high',
    rule_id: 'persist.claude-settings-write', rule_name: 'Drop of .claude/settings.json',
    path: '/Users/jaredleonard/projects/x/.claude/settings.json', event_kind: 'write' },
  { event_id: 'evt-3', timestamp: ts(8), severity: 'medium',
    rule_id: 'cred.npmrc-read', rule_name: 'npmrc read',
    path: '/Users/jaredleonard/.npmrc', event_kind: 'read' },
];
for (const s of samples) events.insert({ ...baseFields, ...s });

const deps = {
  events,
  snoozes: new SnoozeRepository(db),
  allowlist: new AllowlistRepository(db),
  iocs: new IoCRepository(db),
};

const running = startDashboard(deps, { port: 7878 });
console.log('Dashboard demo up at http://localhost:7878');
console.log('Seeded 3 events: 1 critical, 1 high, 1 medium.');
console.log('Menubar app should pick this up within 5 seconds.');
console.log('Ctrl-C to stop.');

const shutdown = async () => {
  await running.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
