import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LinuxProcessReader,
  MacosProcessReader,
  MockProcessReader,
  type ProcessReader,
} from '@tripwire/identity';
import type { Logger } from '@tripwire/shared';
import { MockFsWatcher, NativeFsWatcher, type FsWatcher } from '@tripwire/watcher';

/** Best ProcessReader for this OS. Empty MockProcessReader on unsupported platforms. */
export function createPlatformReader(): ProcessReader {
  switch (platform()) {
    case 'linux':
      return new LinuxProcessReader();
    case 'darwin':
      return new MacosProcessReader();
    default:
      return new MockProcessReader();
  }
}

/**
 * Find the `tripwire-watcher` helper binary and return a NativeFsWatcher
 * wrapped around it. Falls back to MockFsWatcher when the helper isn't
 * installed.
 *
 * Lookup order:
 *   1. $TRIPWIRE_WATCHER (override)
 *   2. ../../../helpers/.../tripwire-watcher  (dev / monorepo)
 *   3. brew prefix + a few common system paths
 */
export function createPlatformWatcher(logger?: Logger): FsWatcher {
  const helper = findHelper();
  if (helper) {
    logger?.info({ helper }, 'using NativeFsWatcher');
    return new NativeFsWatcher({
      helperPath: helper,
      onStderr: line => logger?.debug({ line }, 'watcher stderr'),
    });
  }
  logger?.warn(
    'tripwire-watcher helper not found; using MockFsWatcher (no kernel events). Set TRIPWIRE_WATCHER to override.',
  );
  return new MockFsWatcher();
}

function findHelper(): string | null {
  const fromEnv = process.env.TRIPWIRE_WATCHER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    here = process.cwd();
  }
  // dist path: packages/daemon/dist/platform.js → repo root four levels up
  const devCandidate = resolve(
    here,
    '../../..',
    'helpers/tripwire-watcher/target/release/tripwire-watcher',
  );
  if (existsSync(devCandidate)) return devCandidate;

  const candidates = [
    '/opt/homebrew/opt/tripwire/libexec/bin/tripwire-watcher',
    '/opt/homebrew/opt/tripwire/libexec/helpers/tripwire-watcher/target/release/tripwire-watcher',
    '/usr/local/opt/tripwire/libexec/bin/tripwire-watcher',
    '/opt/homebrew/bin/tripwire-watcher',
    '/usr/local/bin/tripwire-watcher',
    join(process.env.HOME ?? '', '.tripwire/bin/tripwire-watcher'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}
