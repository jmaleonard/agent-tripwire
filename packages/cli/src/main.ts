// Entrypoint that actually invokes the CLI. The brew-generated wrapper
// (and bin/tripwire.mjs) calls `node main.js`, which runs this file.
import { run } from './cli.js';

run(process.argv.slice(2)).catch(err => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`tripwire: ${msg}\n`);
  process.exit(1);
});
