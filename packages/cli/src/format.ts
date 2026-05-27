import type { Severity } from '@tripwire/shared';

const stdoutIsTTY = process.stdout.isTTY === true;

export const c = stdoutIsTTY
  ? {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      gray: '\x1b[90m',
    }
  : {
      reset: '',
      bold: '',
      dim: '',
      red: '',
      green: '',
      yellow: '',
      blue: '',
      magenta: '',
      cyan: '',
      gray: '',
    };

export function severityColor(s: Severity): string {
  switch (s) {
    case 'critical': return c.red;
    case 'high': return c.yellow;
    case 'medium': return c.cyan;
    case 'low': return c.blue;
    case 'info': return c.gray;
  }
}

export function severityBadge(s: Severity): string {
  return `${severityColor(s)}${c.bold}${s.toUpperCase()}${c.reset}`;
}

export interface Column {
  label: string;
  /** width in chars. Undefined = auto. */
  width?: number;
  align?: 'left' | 'right';
}

export function renderTable(columns: Column[], rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const widths = columns.map((col, i) =>
    col.width ?? Math.max(col.label.length, ...rows.map(r => stripAnsi(r[i] ?? '').length)),
  );
  const fmt = (cells: ReadonlyArray<string>): string =>
    columns
      .map((col, i) => {
        const value = cells[i] ?? '';
        return col.align === 'right' ? padStartAnsi(value, widths[i]!) : padEndAnsi(value, widths[i]!);
      })
      .join('  ');
  const header = `${c.bold}${fmt(columns.map(c => c.label))}${c.reset}`;
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  return [header, c.dim + sep + c.reset, ...rows.map(fmt)].join('\n');
}

function stripAnsi(s: string): string {
  // Strip CSI/SGR sequences for width math. Conservative pattern.
  return s.replace(/\[[0-9;]*m/g, '');
}

function padEndAnsi(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  return s + ' '.repeat(Math.max(0, width - visible));
}

function padStartAnsi(s: string, width: number): string {
  const visible = stripAnsi(s).length;
  return ' '.repeat(Math.max(0, width - visible)) + s;
}

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const sec = Math.round((now.getTime() - then) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}
