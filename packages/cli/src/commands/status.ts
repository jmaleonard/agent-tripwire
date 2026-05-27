import { ApiClient } from '../api.js';
import { c, relativeTime, severityBadge } from '../format.js';
import { formatRemaining } from '../duration.js';

interface Summary {
  counts: Record<'critical' | 'high' | 'medium' | 'low' | 'info', number>;
  recent: Array<{
    event_id: string;
    timestamp: string;
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    rule_id: string;
    rule_name: string | null;
    ancestry_category: string;
  }>;
  snoozes: { active: boolean; kind: string | null; expires_at: string | null };
}

export async function statusCommand(_args: string[]): Promise<number> {
  const api = new ApiClient();
  let summary: Summary;
  try {
    summary = await api.get<Summary>('/api/summary');
  } catch (err) {
    process.stderr.write(`${c.red}Could not reach the daemon at ${api['base']}.${c.reset}\n`);
    process.stderr.write(`${c.dim}Start it with: tripwire daemon run${c.reset}\n`);
    return 2;
  }

  const { counts } = summary;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  process.stdout.write(
    `${c.bold}Last 24h:${c.reset} ${total} events  ` +
      `(${c.red}${counts.critical} crit${c.reset} · ${c.yellow}${counts.high} high${c.reset} · ${c.cyan}${counts.medium} med${c.reset} · ${c.blue}${counts.low} low${c.reset} · ${c.gray}${counts.info} info${c.reset})\n`,
  );

  if (summary.snoozes.active) {
    const exp = summary.snoozes.expires_at;
    const remaining = exp ? formatRemaining(exp) : '?';
    process.stdout.write(
      `${c.magenta}⌚ Snoozed${c.reset} (${summary.snoozes.kind ?? 'active'}) for ${remaining} more.\n`,
    );
  }

  if (summary.recent.length === 0) {
    process.stdout.write(`${c.dim}No recent events.${c.reset}\n`);
    return 0;
  }
  process.stdout.write('\n');
  process.stdout.write(`${c.bold}Recent${c.reset}\n`);
  const now = new Date();
  for (const e of summary.recent) {
    const when = relativeTime(e.timestamp, now);
    process.stdout.write(
      `  ${severityBadge(e.severity)}  ${e.rule_name ?? e.rule_id}  ${c.dim}(${e.ancestry_category}, ${when})${c.reset}\n`,
    );
  }
  return 0;
}
