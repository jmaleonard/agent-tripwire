import { homedir, platform } from 'node:os';

/**
 * Default watch paths from spec §6.13 + the credential / persistence
 * locations covered by the bundled rule pack. Tilde-expanded against the
 * runtime homedir; platform-specific paths are filtered. Glob patterns
 * (`*`, `**`) are passed through; the Rust watcher's resolve_path expands
 * them at startup.
 */
export function defaultWatchPaths(): { read_paths: string[]; write_paths: string[] } {
  const home = homedir();
  const expand = (p: string): string => (p.startsWith('~/') ? `${home}/${p.slice(2)}` : p);
  const isMac = platform() === 'darwin';
  const isLinux = platform() === 'linux';

  const reads = [
    // SSH + cloud auth
    '~/.ssh',
    '~/.aws',
    '~/.kube/config',
    '~/.config/gh',
    '~/.docker/config.json',
    // Auth in legacy / package-manager locations
    '~/.netrc',
    '~/.npmrc',
    // Agent config (read access could leak session state)
    '~/.config/claude',
    // GPG secret keys (write/read both interesting; reads alarm)
    '~/.gnupg/private-keys-v1.d',
    // Browser cookies (per-profile)
    isMac ? '~/Library/Application Support/Google/Chrome/*/Cookies' : null,
    isMac ? '~/Library/Application Support/Firefox/Profiles/*/cookies.sqlite' : null,
    isMac ? '~/Library/Application Support/BraveSoftware/Brave-Browser/*/Cookies' : null,
    isMac ? '~/Library/Cookies/Cookies.binarycookies' : null,
    isLinux ? '~/.config/google-chrome/*/Cookies' : null,
    isLinux ? '~/.config/BraveSoftware/Brave-Browser/*/Cookies' : null,
    isLinux ? '~/.mozilla/firefox/*/cookies.sqlite' : null,
  ].filter((p): p is string => p !== null);

  const writes = [
    // Agent / IDE persistence vectors
    '**/.claude/settings.json',
    '**/.vscode/tasks.json',
    // Shell startup files
    '~/.bashrc',
    '~/.zshrc',
    '~/.zprofile',
    '~/.zshenv',
    '~/.profile',
    '~/.bash_profile',
    '~/.config/fish/config.fish',
    // OS-level autostart
    isMac ? '~/Library/LaunchAgents' : null,
    isLinux ? '~/.config/systemd/user' : null,
    isLinux ? '~/.config/autostart' : null,
  ].filter((p): p is string => p !== null);

  return {
    read_paths: reads.map(expand),
    write_paths: writes.map(expand),
  };
}
