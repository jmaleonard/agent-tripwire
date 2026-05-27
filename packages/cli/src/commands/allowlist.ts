import { ApiClient } from '../api.js';
import { c, renderTable } from '../format.js';

interface Entry {
  id: number;
  scope: 'rule' | 'rule+ancestry' | 'rule+process';
  rule_id?: string;
  ancestry_hash?: string;
  process_path?: string;
  reason?: string;
  created_at: string;
}

export async function allowlistCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? 'list';
  const api = new ApiClient();
  switch (sub) {
    case 'list':
      return list(api);
    case 'add':
      return add(api, args.slice(1));
    case 'remove':
    case 'rm':
      return remove(api, args.slice(1));
    default:
      process.stderr.write(`Unknown allowlist subcommand: ${sub}\n`);
      printUsage();
      return 1;
  }
}

async function list(api: ApiClient): Promise<number> {
  const { entries } = await api.get<{ entries: Entry[] }>('/api/allowlist');
  if (entries.length === 0) {
    process.stdout.write(`${c.dim}No allowlist entries.${c.reset}\n`);
    return 0;
  }
  process.stdout.write(
    renderTable(
      [
        { label: 'ID', align: 'right' },
        { label: 'SCOPE' },
        { label: 'RULE' },
        { label: 'PROCESS' },
        { label: 'REASON' },
      ],
      entries.map(e => [
        String(e.id),
        e.scope,
        e.rule_id ?? '—',
        e.process_path ?? '—',
        e.reason ?? '',
      ]),
    ) + '\n',
  );
  return 0;
}

async function add(api: ApiClient, args: string[]): Promise<number> {
  // tripwire allowlist add <rule_id> [--ancestry <hash> | --process <path>] [--reason "..."]
  const ruleId = args[0];
  if (!ruleId) {
    process.stderr.write('tripwire allowlist add <rule_id> [--ancestry <hash> | --process <path>]\n');
    return 1;
  }
  const ancestry = flag(args, '--ancestry');
  const processPath = flag(args, '--process');
  const reason = flag(args, '--reason');
  let scope: Entry['scope'] = 'rule';
  if (ancestry) scope = 'rule+ancestry';
  else if (processPath) scope = 'rule+process';

  const body: Record<string, unknown> = { scope, rule_id: ruleId };
  if (ancestry) body.ancestry_hash = ancestry;
  if (processPath) body.process_path = processPath;
  if (reason) body.reason = reason;

  const created = await api.post<Entry>('/api/allowlist', body);
  process.stdout.write(`${c.green}Allowlisted${c.reset} ${created.scope} (id ${created.id}) for ${ruleId}\n`);
  return 0;
}

async function remove(api: ApiClient, args: string[]): Promise<number> {
  const id = Number(args[0]);
  if (!Number.isFinite(id)) {
    process.stderr.write('tripwire allowlist remove <id>\n');
    return 1;
  }
  await api.del(`/api/allowlist/${id}`);
  process.stdout.write(`Removed allowlist entry ${id}.\n`);
  return 0;
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  return args[i + 1];
}

function printUsage(): void {
  process.stderr.write(`Usage:
  tripwire allowlist list
  tripwire allowlist add <rule_id> [--ancestry <hash> | --process <path>] [--reason "..."]
  tripwire allowlist remove <id>
`);
}
