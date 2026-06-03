import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../src/default-rules.js';

const EXPECTED_IDS = [
  // credential-access
  'cred.ssh-private-key-read',
  'cred.aws-credentials-read',
  'cred.kubeconfig-read',
  'cred.gh-token-read',
  'cred.docker-config-read',
  'cred.npmrc-read',
  'cred.netrc-read',
  'cred.gpg-secret-key-read',
  'cred.browser-cookie-read',
  // persistence
  'persist.claude-settings-write',
  'persist.vscode-tasks-write',
  'persist.shell-rc-modification',
  'persist.launchd-plist-drop',
  'persist.systemd-unit-drop',
  'persist.xdg-autostart-drop',
];

describe('DEFAULT_RULES', () => {
  it('exports the expected rule set (so accidental removals fail CI)', () => {
    expect(DEFAULT_RULES.map(r => r.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it('every rule has the structural fields the engine needs', () => {
    for (const rule of DEFAULT_RULES) {
      expect(rule.id, `rule.id`).toMatch(/^[a-z]+\.[a-z0-9-]+(\.[a-z0-9-]+)*$/);
      expect(rule.name, `rule.name for ${rule.id}`).toMatch(/.+/);
      expect(['critical', 'high', 'medium', 'low', 'info']).toContain(rule.severity);
      expect(['credential-access', 'persistence', 'defense-evasion', 'exfiltration', 'metadata'])
        .toContain(rule.category);
      expect(rule.applies_to, `applies_to for ${rule.id}`).toBeDefined();
      expect(rule.applies_to.event_kind, `event_kind for ${rule.id}`).toBeDefined();
      const hasPathPredicate =
        rule.applies_to.path &&
        ((rule.applies_to.path.home_relative?.length ?? 0) > 0 ||
          (rule.applies_to.path.glob?.length ?? 0) > 0 ||
          (rule.applies_to.path.starts_with?.length ?? 0) > 0 ||
          (rule.applies_to.path.equals?.length ?? 0) > 0);
      expect(hasPathPredicate, `path predicate for ${rule.id}`).toBe(true);
    }
  });

  it('credential-access rules require at least the read or open event_kind', () => {
    for (const rule of DEFAULT_RULES.filter(r => r.category === 'credential-access')) {
      const kinds = new Set(rule.applies_to.event_kind ?? []);
      const hasReadOrOpen = kinds.has('read') || kinds.has('open');
      expect(hasReadOrOpen, `${rule.id} should watch read/open`).toBe(true);
    }
  });

  it('persistence rules require write or create', () => {
    for (const rule of DEFAULT_RULES.filter(r => r.category === 'persistence')) {
      const kinds = new Set(rule.applies_to.event_kind ?? []);
      const hasWriteOrCreate = kinds.has('write') || kinds.has('create');
      expect(hasWriteOrCreate, `${rule.id} should watch write/create`).toBe(true);
    }
  });

  it('every rule explicitly excludes human-shell from its ancestry filter (or relies on a tighter `in` set)', () => {
    for (const rule of DEFAULT_RULES) {
      const ac = rule.applies_to.ancestry_category;
      if (!ac) {
        // Catch-all rules are allowed but flag them for review.
        continue;
      }
      const allowed =
        (ac.not_in?.includes('human-shell') ?? false) ||
        (ac.in !== undefined && !ac.in.includes('human-shell'));
      expect(allowed, `${rule.id} doesn't exclude human-shell`).toBe(true);
    }
  });
});
