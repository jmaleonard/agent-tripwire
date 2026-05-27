import { existsSync, rmSync } from 'node:fs';
import { cliPaths } from '../config.js';
import { c } from '../format.js';

export async function uninstallCommand(args: string[]): Promise<number> {
  const purge = args.includes('--purge');
  const paths = cliPaths();
  process.stdout.write(`${c.bold}tripwire uninstall${c.reset}\n\n`);

  process.stdout.write(`${c.dim}# Stop + remove the brew service${c.reset}\n`);
  process.stdout.write(`  brew services stop tripwire\n`);
  process.stdout.write(`  brew uninstall tripwire\n\n`);

  if (purge) {
    if (existsSync(paths.tripwireDir)) {
      rmSync(paths.tripwireDir, { recursive: true, force: true });
      process.stdout.write(`${c.green}✓${c.reset} purged ${paths.tripwireDir}\n`);
    } else {
      process.stdout.write(`${c.dim}~/.tripwire/ already gone${c.reset}\n`);
    }
  } else {
    process.stdout.write(
      `${c.dim}~/.tripwire/ kept (events.db, allowlist, config). Use --purge to also delete.${c.reset}\n`,
    );
  }
  return 0;
}
