import type { SnoozeKind } from '@tripwire/shared';
import type { SnoozeRepository } from '@tripwire/store';
import { formatRemaining, parseSnoozeWindow } from '../duration.js';
import { c, renderTable } from '../format.js';
import { DbNotFoundError, reportNoStore, withStore } from '../store.js';

export async function snoozeCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? 'list';
  try {
    return await withStore(({ snoozes }) => {
      switch (sub) {
        case 'list':
          return listSnoozes(snoozes);
        case 'add':
          return addSnooze(snoozes, args.slice(1));
        case 'clear':
          return clearSnooze(snoozes, args.slice(1));
        default:
          process.stderr.write(`Unknown snooze subcommand: ${sub}\n`);
          printUsage();
          return 1;
      }
    });
  } catch (err) {
    if (err instanceof DbNotFoundError) return reportNoStore();
    throw err;
  }
}

function listSnoozes(snoozes: SnoozeRepository): number {
  const now = new Date();
  const active = snoozes.listActive(now);
  if (active.length === 0) {
    process.stdout.write(`${c.dim}No active snoozes.${c.reset}\n`);
    return 0;
  }
  const rows = active.map(s => [
    String(s.id),
    s.kind,
    s.rule_id ?? '—',
    formatRemaining(s.expires_at, now),
    s.reason ?? '',
  ]);
  process.stdout.write(
    renderTable(
      [
        { label: 'ID', align: 'right' },
        { label: 'KIND' },
        { label: 'RULE' },
        { label: 'REMAINING' },
        { label: 'REASON' },
      ],
      rows,
    ) + '\n',
  );
  return 0;
}

function addSnooze(snoozes: SnoozeRepository, args: string[]): number {
  const windowArg = args[0];
  if (!windowArg) {
    process.stderr.write('tripwire snooze add <window>  e.g. 5m, 15m, 1h, 4h, until_morning\n');
    return 1;
  }
  const ruleId = readFlag(args, '--rule');
  const ancestry = readFlag(args, '--ancestry');
  const reason = readFlag(args, '--reason');
  const kind: SnoozeKind = ruleId && ancestry ? 'this' : 'all';

  const base = {
    expires_at: parseSnoozeWindow(windowArg).toISOString(),
    created_at: new Date().toISOString(),
    ...(reason ? { reason } : {}),
  };
  const created =
    kind === 'this'
      ? snoozes.add({ kind, rule_id: ruleId!, ancestry_hash: ancestry!, ...base })
      : snoozes.add({ kind, ...base });

  process.stdout.write(
    `${c.green}Snoozed${c.reset} (id ${created.id}, ${kind}) until ${created.expires_at}\n`,
  );
  return 0;
}

function clearSnooze(snoozes: SnoozeRepository, args: string[]): number {
  const id = args[0];
  let removed: number;
  if (id === undefined || id === 'all') {
    removed = snoozes.clear();
  } else {
    const n = Number(id);
    if (!Number.isFinite(n)) {
      process.stderr.write(`Invalid snooze id: ${id}\n`);
      return 1;
    }
    removed = snoozes.clear(n);
  }
  process.stdout.write(`Cleared ${removed} snooze${removed === 1 ? '' : 's'}.\n`);
  return 0;
}

function readFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function printUsage(): void {
  process.stderr.write(`Usage:
  tripwire snooze list
  tripwire snooze add <window> [--rule <id> --ancestry <hash>] [--reason "..."]
  tripwire snooze clear [<id>|all]

Windows: 5m, 15m, 1h, 4h, until_morning (max 24h)
`);
}
