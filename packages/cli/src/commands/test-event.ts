import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { EventKind } from '@tripwire/shared';
import { executeTestEvent } from '@tripwire/daemon';
import { cliPaths } from '../config.js';
import { c, severityBadge } from '../format.js';
import { reportNoStore } from '../store.js';

const VALID_KINDS = new Set<EventKind>(['read', 'write', 'open', 'create', 'unlink', 'rename']);

const PRESETS: Record<string, { path: string; kind: EventKind }> = {
  aws: { path: '~/.aws/credentials', kind: 'read' },
  ssh: { path: '~/.ssh/id_rsa', kind: 'read' },
  gh: { path: '~/.config/gh/hosts.yml', kind: 'read' },
  npmrc: { path: '~/.npmrc', kind: 'read' },
  claude: { path: '~/projects/example/.claude/settings.json', kind: 'write' },
};

export async function testEventCommand(args: string[]): Promise<number> {
  if (args[0] === 'list' || args[0] === '--list') {
    process.stdout.write(`${c.bold}Presets${c.reset}\n`);
    for (const [name, { path, kind }] of Object.entries(PRESETS)) {
      process.stdout.write(`  ${c.cyan}${name.padEnd(8)}${c.reset}  ${kind.padEnd(6)}  ${path}\n`);
    }
    return 0;
  }

  const preset = args[0] && !args[0].startsWith('--') ? PRESETS[args[0]] : undefined;
  const path = readFlag(args, '--path') ?? preset?.path ?? '~/.aws/credentials';
  const kind = (readFlag(args, '--kind') ?? preset?.kind ?? 'read') as EventKind;
  const pidRaw = readFlag(args, '--pid');

  if (!VALID_KINDS.has(kind)) {
    process.stderr.write(`Invalid --kind: ${kind} (${[...VALID_KINDS].join(' | ')})\n`);
    return 1;
  }
  const expandedPath = path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path;

  const { dbPath } = cliPaths();
  if (!existsSync(dbPath)) return reportNoStore();

  let events;
  try {
    events = await executeTestEvent({
      dbPath,
      path: expandedPath,
      kind,
      ...(pidRaw !== undefined ? { pid: Number(pidRaw) } : {}),
    });
  } catch (err) {
    process.stderr.write(`${c.red}test-event failed:${c.reset} ${(err as Error).message}\n`);
    return 1;
  }

  if (events.length === 0) {
    process.stdout.write(
      `${c.yellow}No rule matched${c.reset} for ${expandedPath} (${kind}).\n` +
        `${c.dim}Either the path isn't watched by any rule, or the firing process's ancestry was allowlisted.${c.reset}\n`,
    );
    return 0;
  }

  process.stdout.write(`${c.green}Fired ${events.length} event${events.length === 1 ? '' : 's'}:${c.reset}\n`);
  for (const e of events) {
    const tail = [
      e.notified ? `${c.green}notified${c.reset}` : `${c.dim}silent${c.reset}`,
      e.snoozed ? `${c.magenta}snoozed${c.reset}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    process.stdout.write(
      `  ${severityBadge(e.severity)}  ${e.rule_id}  ${c.dim}(${e.identity.category})${c.reset}  [${tail}]\n`,
    );
  }
  return 0;
}

function readFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}
