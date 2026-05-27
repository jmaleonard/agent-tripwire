import { homedir } from 'node:os';
import { ApiClient } from '../api.js';
import { c, severityBadge } from '../format.js';

interface TestEventResponse {
  ok: boolean;
  fired: number;
  events: Array<{
    event_id: string;
    rule_id: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    category: string;
    snoozed: boolean;
    notified: boolean;
  }>;
}

const PRESETS: Record<string, { path: string; kind: string }> = {
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
  const path = readFlag(args, '--path') ?? preset?.path ?? `${homedir()}/.aws/credentials`;
  const kind = readFlag(args, '--kind') ?? preset?.kind ?? 'read';
  const pid = readFlag(args, '--pid');

  const expandedPath = path.startsWith('~/') ? `${homedir()}/${path.slice(2)}` : path;

  const api = new ApiClient();
  if (!(await api.isReachable())) {
    process.stderr.write(`${c.red}Daemon not reachable.${c.reset} Start it: ${c.cyan}brew services start tripwire${c.reset} or ${c.cyan}tripwire daemon run${c.reset}\n`);
    return 2;
  }

  let result: TestEventResponse;
  try {
    result = await api.post<TestEventResponse>('/api/test-event', {
      path: expandedPath,
      kind,
      ...(pid !== undefined ? { pid: Number(pid) } : {}),
    });
  } catch (err) {
    process.stderr.write(`${c.red}test-event failed:${c.reset} ${(err as Error).message}\n`);
    return 1;
  }

  if (result.fired === 0) {
    process.stdout.write(
      `${c.yellow}No rule matched${c.reset} for ${expandedPath} (${kind}).\n` +
        `${c.dim}Either the path isn't watched by any rule, or the firing process's ancestry was allowlisted.${c.reset}\n`,
    );
    return 0;
  }

  process.stdout.write(`${c.green}Fired ${result.fired} event${result.fired === 1 ? '' : 's'}:${c.reset}\n`);
  for (const e of result.events) {
    const tail = [
      e.notified ? `${c.green}notified${c.reset}` : `${c.dim}silent${c.reset}`,
      e.snoozed ? `${c.magenta}snoozed${c.reset}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    process.stdout.write(
      `  ${severityBadge(e.severity)}  ${e.rule_id}  ${c.dim}(${e.category})${c.reset}  [${tail}]\n`,
    );
  }
  return 0;
}

function readFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}
