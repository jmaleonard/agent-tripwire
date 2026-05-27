import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CliPaths {
  tripwireDir: string;
  dbPath: string;
  logFile: string;
  errLogFile: string;
  launchAgentPlist: string;
}

export function cliPaths(): CliPaths {
  const home = homedir();
  const tripwireDir = join(home, '.tripwire');
  return {
    tripwireDir,
    dbPath: join(tripwireDir, 'events.db'),
    logFile: join(tripwireDir, 'tripwired.log'),
    errLogFile: join(tripwireDir, 'tripwired.err.log'),
    launchAgentPlist: join(home, 'Library', 'LaunchAgents', 'dev.dawnika.tripwired.plist'),
  };
}
