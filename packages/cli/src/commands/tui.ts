import { c } from '../format.js';
import { DbNotFoundError, reportNoStore } from '../store.js';
import { runTui } from '../tui/run.js';

export async function tuiCommand(_args: string[]): Promise<number> {
  if (!process.stdout.isTTY) {
    process.stderr.write(
      `${c.yellow}tripwire tui needs an interactive terminal.${c.reset} ` +
        `Use ${c.cyan}tripwire status${c.reset} for non-interactive output.\n`,
    );
    return 1;
  }
  try {
    return await runTui();
  } catch (err) {
    if (err instanceof DbNotFoundError) return reportNoStore();
    throw err;
  }
}
