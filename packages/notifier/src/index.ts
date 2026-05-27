import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { LinuxNotifier } from './notify-linux.js';
import { MacosNotifier } from './notify-macos.js';
import { MockNotifier } from './notify-mock.js';
import type { Notifier } from './types.js';

export { formatEvent } from './format.js';
export { LinuxNotifier, type LinuxNotifierOptions } from './notify-linux.js';
export { MacosNotifier, type MacosNotifierOptions } from './notify-macos.js';
export { MockNotifier } from './notify-mock.js';
export type { NotificationPayload, Notifier, NotifyOptions } from './types.js';

export function createNotifier(): Notifier {
  switch (platform()) {
    case 'darwin': {
      const tripwireNotifier = findTripwireMacosNotifier();
      return tripwireNotifier
        ? new MacosNotifier({ tripwireNotifierPath: tripwireNotifier })
        : new MacosNotifier();
    }
    case 'linux':
      return new LinuxNotifier();
    default:
      return new MockNotifier();
  }
}

/**
 * Find the Tripwire Menubar.app's main binary on disk. The daemon spawns it
 * with `--notify ...` to fire notifications under our bundle identity
 * (`dev.dawnika.tripwire.menubar`) — banners then show "Tripwire Menubar"
 * as the source app instead of "terminal-notifier" / "Script Editor".
 */
export function findTripwireMacosNotifier(): string | undefined {
  const env = process.env.TRIPWIRE_NOTIFIER;
  if (env && existsSync(env)) return env;
  const candidates = [
    '/opt/homebrew/opt/tripwire/Tripwire Menubar.app/Contents/MacOS/TripwireMenubar',
    '/usr/local/opt/tripwire/Tripwire Menubar.app/Contents/MacOS/TripwireMenubar',
    join(homedir(), 'Applications/Tripwire Menubar.app/Contents/MacOS/TripwireMenubar'),
    '/Applications/Tripwire Menubar.app/Contents/MacOS/TripwireMenubar',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}
