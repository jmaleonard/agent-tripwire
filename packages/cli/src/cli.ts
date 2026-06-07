import { c } from './format.js';
import { allowlistCommand } from './commands/allowlist.js';
import { daemonCommand } from './commands/daemon.js';
import { doctorCommand } from './commands/doctor.js';
import { iocCommand } from './commands/ioc.js';
import { setupCommand } from './commands/setup.js';
import { snoozeCommand } from './commands/snooze.js';
import { statusCommand } from './commands/status.js';
import { testEventCommand } from './commands/test-event.js';
import { tuiCommand } from './commands/tui.js';
import { uninstallCommand } from './commands/uninstall.js';

type Handler = (args: string[]) => Promise<number>;

const COMMANDS: Record<string, Handler> = {
  setup: setupCommand,
  status: statusCommand,
  tui: tuiCommand,
  doctor: doctorCommand,
  snooze: snoozeCommand,
  allowlist: allowlistCommand,
  ioc: iocCommand,
  daemon: daemonCommand,
  'test-event': testEventCommand,
  uninstall: uninstallCommand,
};

export async function run(argv: string[]): Promise<void> {
  const [first, ...rest] = argv;
  if (!first || first === 'help' || first === '--help' || first === '-h') {
    printHelp();
    return;
  }
  if (first === '--version' || first === '-v') {
    process.stdout.write('tripwire 0.0.0\n');
    return;
  }
  const handler = COMMANDS[first];
  if (!handler) {
    process.stderr.write(`tripwire: unknown command "${first}"\n\n`);
    printHelp();
    process.exit(1);
  }
  const code = await handler(rest);
  if (code !== 0) process.exit(code);
}

function printHelp(): void {
  process.stdout.write(`${c.bold}tripwire${c.reset} — runtime detection daemon for developer workstations

${c.bold}Usage${c.reset}
  tripwire <command> [args]

${c.bold}Commands${c.reset}
  ${c.cyan}setup${c.reset}          first-run wizard: create ~/.tripwire/, apply quiet period
  ${c.cyan}daemon${c.reset} run     run the daemon in the foreground
  ${c.cyan}daemon${c.reset} status  check if the daemon is reachable
  ${c.cyan}status${c.reset}         show counts + recent events + snooze state
  ${c.cyan}tui${c.reset}            live event inspector (interactive terminal UI)
  ${c.cyan}snooze${c.reset}         list / add / clear snoozes
  ${c.cyan}allowlist${c.reset}      list / add / remove allowlist entries
  ${c.cyan}ioc${c.reset} <package>  look up IoC entries for a package
  ${c.cyan}ioc${c.reset} sync       pull the latest IoC feed into the local DB
  ${c.cyan}doctor${c.reset}         health checks (Node version, daemon running, feed freshness)
  ${c.cyan}test-event${c.reset}     fire a synthetic FsEvent through the detection pipeline
  ${c.cyan}uninstall${c.reset}      print uninstall steps; --purge also deletes ~/.tripwire/

${c.bold}Examples${c.reset}
  tripwire setup
  tripwire daemon run                    # blocks; Ctrl-C to stop
  tripwire snooze add 15m
  tripwire snooze add 1h --rule cred.aws-credentials-read --ancestry abc123
  tripwire allowlist add cred.aws-credentials-read --process /usr/bin/aws
  tripwire ioc node-ipc
  tripwire ioc sync                      # refresh the local IoC DB from the feed
  tripwire test-event aws                # fire a synthetic ~/.aws/credentials read
  tripwire test-event --path ~/.ssh/id_rsa --kind read

${c.bold}Data${c.reset}
  ~/.tripwire/events.db   local event store; the CLI, TUI, and daemon share it
`);
}
