import { existsSync, mkdirSync } from 'node:fs';
import {
  closeDb,
  openDb,
  SnoozeRepository,
} from '@tripwire/store';
import { cliPaths } from '../config.js';
import { c } from '../format.js';

const QUIET_PERIOD_MINUTES = 60;

export async function setupCommand(_args: string[]): Promise<number> {
  const paths = cliPaths();
  process.stdout.write(`${c.bold}tripwire setup${c.reset}\n\n`);

  // 1. Create ~/.tripwire/
  if (!existsSync(paths.tripwireDir)) {
    mkdirSync(paths.tripwireDir, { recursive: true });
    process.stdout.write(`${c.green}✓${c.reset} created ${paths.tripwireDir}\n`);
  } else {
    process.stdout.write(`${c.green}✓${c.reset} ${paths.tripwireDir} already exists\n`);
  }

  // 2. Open events.db (creates + migrates). Apply the first-run quiet period
  //    snooze if no snoozes exist yet — when the daemon launches it sees this
  //    snooze already in place and stays silent for the first hour (spec §6.8).
  const db = openDb({ path: paths.dbPath });
  try {
    const snoozes = new SnoozeRepository(db);
    if (snoozes.list().length === 0) {
      const now = new Date();
      const expires = new Date(now.getTime() + QUIET_PERIOD_MINUTES * 60_000);
      snoozes.add({
        kind: 'all',
        expires_at: expires.toISOString(),
        created_at: now.toISOString(),
        reason: `first-run quiet period (${QUIET_PERIOD_MINUTES} min)`,
      });
      process.stdout.write(
        `${c.green}✓${c.reset} first-run quiet period: notifications silenced for ${QUIET_PERIOD_MINUTES} min ${c.dim}(events still recorded)${c.reset}\n`,
      );
    } else {
      process.stdout.write(`${c.dim}~${c.reset} snoozes table already populated, skipping quiet period\n`);
    }
  } finally {
    closeDb(db);
  }

  process.stdout.write(`\n${c.bold}Next steps${c.reset}\n`);
  process.stdout.write(`  • Start the daemon: ${c.cyan}brew services start tripwire${c.reset}\n`);
  process.stdout.write(`    or ad-hoc:        ${c.cyan}tripwire daemon run${c.reset}\n`);
  process.stdout.write(`  • Inspect events:   ${c.cyan}tripwire tui${c.reset}\n`);
  process.stdout.write(`  • Quick status:     ${c.cyan}tripwire status${c.reset}\n`);
  process.stdout.write(`  • If macOS prompts to allow notifications, allow them.\n`);
  return 0;
}
