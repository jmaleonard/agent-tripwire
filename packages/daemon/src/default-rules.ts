import type { Rule } from '@tripwire/shared';

/**
 * Bundled rule pack. Each rule maps a watched path + event kind to a
 * severity and category. `ancestry_category.not_in: ['human-shell']` is the
 * recurring noise-control pattern — a user running `aws` or `kubectl`
 * directly from their terminal is implicitly allowlisted.
 *
 * Naming + severity guidance from spec §6.5 and docs/rules.md.
 */
export const DEFAULT_RULES: ReadonlyArray<Rule> = [
  // ── credential-access ──────────────────────────────────────────────────

  {
    id: 'cred.ssh-private-key-read',
    name: 'SSH private key read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-shell process read a file under ~/.ssh that looks like a private key.',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { glob: ['~/.ssh/id_*', '~/.ssh/*_rsa', '~/.ssh/*_ed25519'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.aws-credentials-read',
    name: 'AWS credentials file read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-shell process read ~/.aws/credentials or ~/.aws/config.',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.aws/credentials', '.aws/config'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.kubeconfig-read',
    name: 'Kubernetes config read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-shell process read ~/.kube/config (kubectl bearer tokens).',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.kube/config'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.gh-token-read',
    name: 'GitHub CLI token read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-shell process read the GitHub CLI hosts.yml (auth tokens).',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.config/gh/hosts.yml'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.docker-config-read',
    name: 'Docker config read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-shell process read ~/.docker/config.json (registry auth, possible secrets).',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.docker/config.json'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.npmrc-read',
    name: '.npmrc read',
    severity: 'medium',
    category: 'credential-access',
    description: 'A process read ~/.npmrc (may contain registry auth tokens).',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.npmrc'] },
      ancestry_category: { not_in: ['human-shell', 'package-manager-direct'] },
    },
  },
  {
    id: 'cred.netrc-read',
    name: '.netrc read',
    severity: 'medium',
    category: 'credential-access',
    description: 'A non-shell process read ~/.netrc (legacy auth for ftp / curl / git).',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.netrc'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.gpg-secret-key-read',
    name: 'GPG secret key read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-shell process read a private GPG key under ~/.gnupg/private-keys-v1.d/.',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { glob: ['~/.gnupg/private-keys-v1.d/*.key'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.browser-cookie-read',
    name: 'Browser cookie database read',
    severity: 'high',
    category: 'credential-access',
    description: 'A non-browser process read a Chrome / Firefox / Brave / Safari cookie database.',
    applies_to: {
      event_kind: ['read', 'open'],
      path: {
        glob: [
          // macOS
          '~/Library/Application Support/Google/Chrome/*/Cookies',
          '~/Library/Application Support/Firefox/Profiles/*/cookies.sqlite',
          '~/Library/Application Support/BraveSoftware/Brave-Browser/*/Cookies',
          // Linux
          '~/.config/google-chrome/*/Cookies',
          '~/.config/BraveSoftware/Brave-Browser/*/Cookies',
          '~/.mozilla/firefox/*/cookies.sqlite',
        ],
        home_relative: ['Library/Cookies/Cookies.binarycookies'],
      },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },

  // ── persistence ────────────────────────────────────────────────────────

  {
    id: 'persist.claude-settings-write',
    name: 'Write to .claude/settings.json',
    severity: 'high',
    category: 'persistence',
    description: 'A non-editor / non-agent process wrote to a .claude/settings.json file.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: { glob: ['**/.claude/settings.json'] },
      ancestry_category: { not_in: ['agent-direct', 'human-shell'] },
    },
  },
  {
    id: 'persist.vscode-tasks-write',
    name: 'Write to .vscode/tasks.json',
    severity: 'high',
    category: 'persistence',
    description: 'A non-editor process wrote to a .vscode/tasks.json file.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: { glob: ['**/.vscode/tasks.json'] },
      ancestry_category: { not_in: ['agent-direct', 'human-shell'] },
    },
  },
  {
    id: 'persist.shell-rc-modification',
    name: 'Shell rc file modified',
    severity: 'medium',
    category: 'persistence',
    description: 'A non-shell / non-agent process modified a shell startup file.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: {
        home_relative: [
          '.bashrc', '.bash_profile',
          '.zshrc', '.zprofile', '.zshenv',
          '.profile',
          '.config/fish/config.fish',
        ],
      },
      ancestry_category: { not_in: ['human-shell', 'agent-direct'] },
    },
  },
  {
    id: 'persist.launchd-plist-drop',
    name: 'Drop of launchd agent (macOS persistence)',
    severity: 'high',
    category: 'persistence',
    description: 'A process wrote a launchd plist under ~/Library/LaunchAgents/. Common persistence vector — autostarts on login.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: { glob: ['~/Library/LaunchAgents/*.plist'] },
      // brew services and pkg installers legitimately drop plists from
      // package-manager-spawned contexts; we exclude those.
      ancestry_category: {
        not_in: ['human-shell', 'package-manager-direct', 'package-manager-spawned'],
      },
    },
  },
  {
    id: 'persist.systemd-unit-drop',
    name: 'Drop of systemd user unit (Linux persistence)',
    severity: 'high',
    category: 'persistence',
    description: 'A process wrote a systemd unit file under ~/.config/systemd/user/. Autostarts on login on Linux.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: {
        glob: [
          '~/.config/systemd/user/*.service',
          '~/.config/systemd/user/*.timer',
        ],
      },
      ancestry_category: {
        not_in: ['human-shell', 'package-manager-direct', 'package-manager-spawned'],
      },
    },
  },
  {
    id: 'persist.xdg-autostart-drop',
    name: 'Drop of XDG autostart .desktop file (Linux persistence)',
    severity: 'medium',
    category: 'persistence',
    description: 'A process wrote a .desktop file under ~/.config/autostart/. Autostarts on Linux session login.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: { glob: ['~/.config/autostart/*.desktop'] },
      ancestry_category: {
        not_in: ['human-shell', 'package-manager-direct', 'package-manager-spawned'],
      },
    },
  },
];
