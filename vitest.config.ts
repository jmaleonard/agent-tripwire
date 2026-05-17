import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**/*.ts'],
    },
  },
  resolve: {
    // Workspace packages: resolve tests against source so vitest never depends
    // on a previous `pnpm build`.
    alias: {
      '@tripwire/shared': resolve(__dirname, 'packages/shared/src/index.ts'),
    },
  },
});
