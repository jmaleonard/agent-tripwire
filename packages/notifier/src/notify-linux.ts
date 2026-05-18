import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAtLeast, type Severity, type TripwireEvent } from '@tripwire/shared';
import { formatEvent } from './format.js';
import type { Notifier, NotifyOptions } from './types.js';

export type ExecFn = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecFn = async (cmd, args) =>
  promisify(execFile)(cmd, args, { encoding: 'utf-8' });

export interface LinuxNotifierOptions {
  notifySendPath?: string;
  exec?: ExecFn;
}

const URGENCY: Record<Severity, 'low' | 'normal' | 'critical'> = {
  critical: 'critical',
  high: 'normal',
  medium: 'normal',
  low: 'low',
  info: 'low',
};

/**
 * Linux notifier via notify-send (freedesktop libnotify). Requires a
 * notification daemon running in the session (dunst, mako, GNOME / KDE built-in).
 * No native click-to-open in v1 — libnotify action support is daemon-specific
 * and requires --wait, which we don't want to block on.
 */
export class LinuxNotifier implements Notifier {
  private readonly exec: ExecFn;
  private readonly notifySend: string;

  constructor(opts: LinuxNotifierOptions = {}) {
    this.exec = opts.exec ?? defaultExec;
    this.notifySend = opts.notifySendPath ?? 'notify-send';
  }

  async notify(event: TripwireEvent, opts: NotifyOptions = {}): Promise<boolean> {
    if (event.snoozed) return false;
    if (!isAtLeast(event.severity, opts.minSeverity ?? 'medium')) return false;

    const payload = formatEvent(event, opts);
    try {
      await this.exec(this.notifySend, [
        '--app-name=tripwire',
        `--urgency=${URGENCY[payload.severity]}`,
        '--icon=dialog-warning',
        payload.title,
        payload.body,
      ]);
      return true;
    } catch {
      return false;
    }
  }
}
