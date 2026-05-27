import type { Rule } from '@tripwire/shared';

/**
 * A minimal baseline rule pack. Just enough to exercise the engine
 * end-to-end against the spec's main attack scenarios. The full pack
 * lands in @tripwire/rules later (YAML-loaded).
 *
 * Naming + severity guidance from spec §6.5 and docs/rules.md.
 */
export const DEFAULT_RULES: ReadonlyArray<Rule> = [
  {
    id: 'cred.ssh-private-key-read',
    name: 'SSH private key read',
    severity: 'high',
    category: 'credential-access',
    description: 'A process read a file under ~/.ssh that looks like a private key.',
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
    description: 'A process read ~/.aws/credentials or ~/.aws/config.',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.aws/credentials', '.aws/config'] },
      ancestry_category: { not_in: ['human-shell'] },
    },
  },
  {
    id: 'cred.gh-token-read',
    name: 'GitHub CLI token read',
    severity: 'high',
    category: 'credential-access',
    description: 'A process read the GitHub CLI hosts.yml.',
    applies_to: {
      event_kind: ['read', 'open'],
      path: { home_relative: ['.config/gh/hosts.yml'] },
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
    description: 'A process modified ~/.bashrc / .zshrc / .profile.',
    applies_to: {
      event_kind: ['write', 'create'],
      path: { home_relative: ['.bashrc', '.zshrc', '.profile'] },
      ancestry_category: { not_in: ['human-shell', 'agent-direct'] },
    },
  },
];
