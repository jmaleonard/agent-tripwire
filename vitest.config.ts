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
      '@tripwire/store': resolve(__dirname, 'packages/store/src/index.ts'),
      '@tripwire/feeds': resolve(__dirname, 'packages/feeds/src/index.ts'),
      '@tripwire/watcher': resolve(__dirname, 'packages/watcher/src/index.ts'),
      '@tripwire/identity': resolve(__dirname, 'packages/identity/src/index.ts'),
      '@tripwire/engine': resolve(__dirname, 'packages/engine/src/index.ts'),
      '@tripwire/notifier': resolve(__dirname, 'packages/notifier/src/index.ts'),
      '@tripwire/dashboard': resolve(__dirname, 'packages/dashboard/src/index.ts'),
      '@tripwire/daemon': resolve(__dirname, 'packages/daemon/src/index.ts'),
    },
  },
});
