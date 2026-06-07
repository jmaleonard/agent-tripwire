import { computeSummary } from '@tripwire/store';
import { formatRemaining } from '../duration.js';
import { c, relativeTime, severityBadge } from '../format.js';
import { DbNotFoundError, reportNoStore, withStore } from '../store.js';

export async function statusCommand(_args: string[]): Promise<number> {
  try {
    return await withStore(repos => {
      const summary = computeSummary(repos, { recentLimit: 10 });

      const dot = summary.daemon.running ? `${c.green}●${c.reset}` : `${c.red}●${c.reset}`;
      process.stdout.write(
        `${dot} tripwired ${summary.daemon.running ? 'running' : 'not running'}` +
          (summary.daemon.running
            ? ''
            : `  ${c.dim}(start: brew services start tripwire)${c.reset}`) +
          `\n`,
      );

      const { counts, total } = summary;
      process.stdout.write(
        `${c.bold}Last 24h:${c.reset} ${total} events  ` +
          `(${c.red}${counts.critical} crit${c.reset} · ${c.yellow}${counts.high} high${c.reset} · ` +
          `${c.cyan}${counts.medium} med${c.reset} · ${c.blue}${counts.low} low${c.reset} · ${c.gray}${counts.info} info${c.reset})\n`,
      );

      if (summary.snoozes.active) {
        const remaining = summary.snoozes.expires_at ? formatRemaining(summary.snoozes.expires_at) : '?';
        process.stdout.write(
          `${c.magenta}⌚ Snoozed${c.reset} (${summary.snoozes.kind ?? 'active'}) for ${remaining} more.\n`,
        );
      }

      if (summary.recent.length === 0) {
        process.stdout.write(`${c.dim}No recent events.${c.reset}\n`);
        return 0;
      }

      process.stdout.write(`\n${c.bold}Recent${c.reset}\n`);
      const now = new Date();
      for (const e of summary.recent) {
        const when = relativeTime(e.timestamp, now);
        process.stdout.write(
          `  ${severityBadge(e.severity)}  ${e.rule_name ?? e.rule_id}  ${c.dim}(${e.ancestry_category}, ${when})${c.reset}\n`,
        );
      }
      return 0;
    });
  } catch (err) {
    if (err instanceof DbNotFoundError) return reportNoStore();
    throw err;
  }
}
