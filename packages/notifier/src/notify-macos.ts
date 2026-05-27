import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAtLeast, type TripwireEvent } from '@tripwire/shared';
import { formatEvent } from './format.js';
import type { Notifier, NotifyOptions } from './types.js';

export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = async (cmd, args) =>
  promisify(execFile)(cmd, args, { encoding: 'utf-8' });

export interface MacosNotifierOptions {
  /** Path to terminal-notifier. Defaults to PATH lookup. */
  terminalNotifierPath?: string;
  /** Override exec for tests. */
  exec?: ExecFn;
  /** Skip terminal-notifier and go straight to osascript (mostly for tests). */
  useOsascriptOnly?: boolean;
}

/**
 * macOS notifier. Tries terminal-notifier first (supports click-to-open URL);
 * falls back to osascript (always available, no URL).
 */
export class MacosNotifier implements Notifier {
  private readonly exec: ExecFn;
  private readonly terminalNotifier: string;
  private readonly useOsascriptOnly: boolean;

  constructor(opts: MacosNotifierOptions = {}) {
    this.exec = opts.exec ?? defaultExec;
    this.terminalNotifier = opts.terminalNotifierPath ?? 'terminal-notifier';
    this.useOsascriptOnly = opts.useOsascriptOnly ?? false;
  }

  async notify(event: TripwireEvent, opts: NotifyOptions = {}): Promise<boolean> {
    if (event.snoozed) return false;
    if (!isAtLeast(event.severity, opts.minSeverity ?? 'medium')) return false;

    const payload = formatEvent(event, opts);

    if (!this.useOsascriptOnly) {
      try {
        const args = ['-title', payload.title, '-message', payload.body];
        if (payload.subtitle) args.push('-subtitle', payload.subtitle);
        if (payload.openUrl) args.push('-open', payload.openUrl);
        await this.exec(this.terminalNotifier, args);
        return true;
      } catch {
        // terminal-notifier not installed or failed; fall through.
      }
    }
    return this.sendViaOsascript(payload.title, payload.subtitle, payload.body);
  }

  private async sendViaOsascript(
    title: string,
    subtitle: string | undefined,
    body: string,
  ): Promise<boolean> {
    const safeTitle = escapeAppleScript(title);
    const safeBody = escapeAppleScript(body);
    const safeSubtitle = subtitle ? escapeAppleScript(subtitle) : undefined;
    const script = safeSubtitle
      ? `display notification "${safeBody}" with title "${safeTitle}" subtitle "${safeSubtitle}"`
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
