import { ApiClient } from '../api.js';
import { parseSnoozeWindow, formatRemaining } from '../duration.js';
import { c, renderTable } from '../format.js';

interface Snooze {
  id: number;
  kind: 'this' | 'all';
  rule_id?: string;
  ancestry_hash?: string;
  expires_at: string;
  created_at: string;
  reason?: string;
}

export async function snoozeCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? 'list';
  const api = new ApiClient();
  switch (sub) {
    case 'list':
      return listSnoozes(api);
    case 'add':
      return addSnooze(api, args.slice(1));
    case 'clear':
      return clearSnooze(api, args.slice(1));
    default:
      process.stderr.write(`Unknown snooze subcommand: ${sub}\n`);
      printUsage();
      return 1;
  }
}

async function listSnoozes(api: ApiClient): Promise<number> {
  const { snoozes } = await api.get<{ snoozes: Snooze[] }>('/api/snoozes');
  if (snoozes.length === 0) {
    process.stdout.write(`${c.dim}No active snoozes.${c.reset}\n`);
    return 0;
  }
  const now = new Date();
  const rows = snoozes.map(s => [
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

async function addSnooze(api: ApiClient, args: string[]): Promise<number> {
  const windowArg = args[0];
  if (!windowArg) {
    process.stderr.write('tripwire snooze add <window>  e.g. 5m, 15m, 1h, 4h, until_morning\n');
    return 1;
  }
  const ruleId = readFlag(args, '--rule');
  const ancestry = readFlag(args, '--ancestry');
  const expiresAt = parseSnoozeWindow(windowArg).toISOString();
  const kind = ruleId && ancestry ? 'this' : 'all';
  const body: Record<string, unknown> = { kind, expires_at: expiresAt };
  if (kind === 'this') {
    body.rule_id = ruleId;
    body.ancestry_hash = ancestry;
  }
  const reason = readFlag(args, '--reason');
  if (reason) body.reason = reason;

  const created = await api.post<Snooze>('/api/snoozes', body);
  process.stdout.write(
    `${c.green}Snoozed${c.reset} (id ${created.id}, ${kind}) until ${created.expires_at}\n`,
  );
  return 0;
}

async function clearSnooze(api: ApiClient, args: string[]): Promise<number> {
  const id = args[0];
  if (id === undefined || id === 'all') {
    const { removed } = await api.del<{ removed: number }>('/api/snoozes');
    process.stdout.write(`Cleared ${removed} snooze${removed === 1 ? '' : 's'}.\n`);
    return 0;
  }
  const n = Number(id);
  if (!Number.isFinite(n)) {
    process.stderr.write(`Invalid snooze id: ${id}\n`);
    return 1;
  }
  const { removed } = await api.del<{ removed: number }>(`/api/snoozes/${n}`);
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
