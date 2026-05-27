import { platform } from 'node:os';
import {
  LinuxProcessReader,
  MacosProcessReader,
  MockProcessReader,
  type ProcessReader,
} from '@tripwire/identity';

/**
 * Best ProcessReader for this OS. Falls back to an empty MockProcessReader on
 * unsupported platforms so the daemon still runs (events won't classify but
 * the rest of the pipeline works).
 */
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
