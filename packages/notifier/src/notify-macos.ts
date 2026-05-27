import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAtLeast, type TripwireEvent } from '@tripwire/shared';
import { formatEvent } from './format.js';
import type { Notifier, NotifyOptions } from './types.js';

export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = async (cmd, args) =>
  promisify(execFile)(cmd, args, { encoding: 'utf-8' });

export interface MacosNotifierOptions {
  /**
   * Path to the bundled `Tripwire Menubar.app` binary (TripwireMenubar). When
   * present, `--notify` mode uses UNUserNotificationCenter with our bundle
   * identifier so banners show "Tripwire Menubar" as the source app.
   */
  tripwireNotifierPath?: string;
  /** Path to terminal-notifier. Defaults to PATH lookup. */
  terminalNotifierPath?: string;
  /** Override exec for tests. */
  exec?: ExecFn;
  /** Skip the priority chain and go straight to osascript (mostly for tests). */
  useOsascriptOnly?: boolean;
}

/**
 * macOS notifier. Priority chain for source-app branding:
 *   1. TripwireMenubar --notify     → "Tripwire Menubar" + our icon
 *   2. terminal-notifier            → "terminal-notifier" (generic)
 *   3. osascript                    → "Script Editor" (last resort)
 */
export class MacosNotifier implements Notifier {
  private readonly exec: ExecFn;
  private readonly tripwireNotifier: string | undefined;
  private readonly terminalNotifier: string;
  private readonly useOsascriptOnly: boolean;

  constructor(opts: MacosNotifierOptions = {}) {
    this.exec = opts.exec ?? defaultExec;
    this.tripwireNotifier = opts.tripwireNotifierPath;
    this.terminalNotifier = opts.terminalNotifierPath ?? 'terminal-notifier';
    this.useOsascriptOnly = opts.useOsascriptOnly ?? false;
  }

  async notify(event: TripwireEvent, opts: NotifyOptions = {}): Promise<boolean> {
    if (event.snoozed) return false;
    if (!isAtLeast(event.severity, opts.minSeverity ?? 'medium')) return false;

    const payload = formatEvent(event, opts);

    if (!this.useOsascriptOnly) {
      // 1. Native Tripwire notifier (proper bundle branding).
      if (this.tripwireNotifier) {
        try {
          const args = [
            '--notify',
            '--title', payload.title,
            '--body',  payload.body,
            '--severity', event.severity,
            '--id',    event.event_id,
          ];
          if (payload.subtitle) args.push('--subtitle', payload.subtitle);
          if (payload.openUrl)  args.push('--url', payload.openUrl);
          await this.exec(this.tripwireNotifier, args);
          return true;
        } catch {
          // fall through
        }
      }

      // 2. terminal-notifier.
      try {
        const args = ['-title', payload.title, '-message', payload.body];
        if (payload.subtitle) args.push('-subtitle', payload.subtitle);
        if (payload.openUrl)  args.push('-open', payload.openUrl);
        await this.exec(this.terminalNotifier, args);
        return true;
      } catch {
        // fall through
      }
    }

    // 3. osascript (always available).
    return this.sendViaOsascript(payload.title, payload.subtitle, payload.body);
  }

  private async sendViaOsascript(
    title: string,
    subtitle: string | undefined,
    body: string,
  ): Promise<boolean> {
    const safeTitle = escapeAppleScript(title);
    const safeBody  = escapeAppleScript(body);
    const safeSub   = subtitle ? escapeAppleScript(subtitle) : undefined;
    const script = safeSub
      ? `display notification "${safeBody}" with title "${safeTitle}" subtitle "${safeSub}"`
      : `display notification "${safeBody}" with title "${safeTitle}"`;
    try {
      await this.exec('osascript', ['-e', script]);
      return true;
    } catch {
      return false;
    }
  }
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}
