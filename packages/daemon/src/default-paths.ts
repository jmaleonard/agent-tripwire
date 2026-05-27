import { homedir } from 'node:os';
import { platform } from 'node:os';

/**
 * Default watch paths from spec §6.13. Tilde is expanded against the runtime
 * homedir; platform-specific paths are filtered.
 */
export function defaultWatchPaths(): { read_paths: string[]; write_paths: string[] } {
  const home = homedir();
  const expand = (p: string): string => (p.startsWith('~/') ? `${home}/${p.slice(2)}` : p);
  const isMac = platform() === 'darwin';
  const isLinux = platform() === 'linux';

  const reads = [
    '~/.ssh',
    '~/.aws',
    '~/.config/gh',
    '~/.netrc',
    '~/.npmrc',
    '~/.docker/config.json',
    '~/.config/claude',
    isMac ? '~/Library/Application Support/Google/Chrome/*/Cookies' : null,
    isLinux ? '~/.config/google-chrome/*/Cookies' : null,
  ].filter((p): p is string => p !== null);

  const writes = [
    '**/.claude/settings.json',
    '**/.vscode/tasks.json',
    '~/.bashrc',
    '~/.zshrc',
    '~/.profile',
    '~/.config/fish/config.fish',
    isMac ? '~/Library/LaunchAgents' : null,
    isLinux ? '~/.config/systemd/user' : null,
  ].filter((p): p is string => p !== null);

  return {
    read_paths: reads.map(expand),
    write_paths: writes.map(expand),
  };
}
