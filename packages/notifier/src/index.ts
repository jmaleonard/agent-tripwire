import { platform } from 'node:os';
import { LinuxNotifier } from './notify-linux.js';
import { MacosNotifier } from './notify-macos.js';
import { MockNotifier } from './notify-mock.js';
import type { Notifier } from './types.js';

export { formatEvent } from './format.js';
export { LinuxNotifier, type LinuxNotifierOptions } from './notify-linux.js';
export { MacosNotifier, type MacosNotifierOptions } from './notify-macos.js';
export { MockNotifier } from './notify-mock.js';
export type { NotificationPayload, Notifier, NotifyOptions } from './types.js';

/**
 * Pick the best Notifier for this platform. Mock on unsupported platforms
 * (e.g. Windows in v1) so the daemon still runs and the dashboard still
 * shows events — just no native notifications.
 */
export function createNotifier(): Notifier {
  switch (platform()) {
    case 'darwin':
      return new MacosNotifier();
    case 'linux':
      return new LinuxNotifier();
    default:
      return new MockNotifier();
  }
}
