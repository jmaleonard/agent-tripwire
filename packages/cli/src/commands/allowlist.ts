import type { AllowlistScope } from '@tripwire/shared';
import type { AllowlistRepository } from '@tripwire/store';
import { c, renderTable } from '../format.js';
import { DbNotFoundError, reportNoStore, withStore } from '../store.js';

export async function allowlistCommand(args: string[]): Promise<number> {
  const sub = args[0] ?? 'list';
  try {
    return await withStore(({ allowlist }) => {
      switch (sub) {
        case 'list':
          return list(allowlist);
        case 'add':
          return add(allowlist, args.slice(1));
        case 'remove':
        case 'rm':
          return remove(allowlist, args.slice(1));
        default:
          process.stderr.write(`Unknown allowlist subcommand: ${sub}\n`);
          printUsage();
          return 1;
      }
    });
  } catch (err) {
    if (err instanceof DbNotFoundError) return reportNoStore();
    throw err;
  }
}

function list(allowlist: AllowlistRepository): number {
  const entries = allowlist.list();
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

function add(allowlist: AllowlistRepository, args: string[]): number {
  // tripwire allowlist add <rule_id> [--ancestry <hash> | --process <path>] [--reason "..."]
  const ruleId = args[0];
  if (!ruleId || ruleId.startsWith('--')) {
    process.stderr.write('tripwire allowlist add <rule_id> [--ancestry <hash> | --process <path>]\n');
    return 1;
  }
  const ancestry = flag(args, '--ancestry');
  const processPath = flag(args, '--process');
  const reason = flag(args, '--reason');
  let scope: AllowlistScope = 'rule';
  if (ancestry) scope = 'rule+ancestry';
  else if (processPath) scope = 'rule+process';

  const created = allowlist.add({
    scope,
    rule_id: ruleId,
    ...(ancestry ? { ancestry_hash: ancestry } : {}),
    ...(processPath ? { process_path: processPath } : {}),
    ...(reason ? { reason } : {}),
    created_at: new Date().toISOString(),
  });
  process.stdout.write(
    `${c.green}Allowlisted${c.reset} ${created.scope} (id ${created.id}) for ${ruleId}\n`,
  );
  return 0;
}

function remove(allowlist: AllowlistRepository, args: string[]): number {
  const id = Number(args[0]);
  if (!Number.isFinite(id)) {
    process.stderr.write('tripwire allowlist remove <id>\n');
    return 1;
  }
  const ok = allowlist.remove(id);
  process.stdout.write(ok ? `Removed allowlist entry ${id}.\n` : `No allowlist entry with id ${id}.\n`);
  return ok ? 0 : 1;
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
