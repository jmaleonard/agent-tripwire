// Bundle the Lambda handler into a single ESM file with workspace deps inlined.
// AWS SDK is excluded because the Node 22 Lambda runtime provides it.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, 'dist');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(__dirname, 'src/handler.ts')],
  outfile: resolve(outDir, 'handler.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@aws-sdk/*'],
  // Patch CommonJS interop in bundled ESM output.
  banner: {
    js: [
      "import { createRequire as __tripwireCreateRequire } from 'node:module';",
      "const require = __tripwireCreateRequire(import.meta.url);",
    ].join('\n'),
  },
  logLevel: 'info',
});

console.log(`Bundled Lambda handler -> ${resolve(outDir, 'handler.mjs')}`);
