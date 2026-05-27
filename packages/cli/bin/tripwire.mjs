#!/usr/bin/env node
import { run } from '../dist/cli.js';

run(process.argv.slice(2)).catch(err => {
  process.stderr.write(`tripwire: ${err.message ?? err}\n`);
  process.exit(1);
});
