import type { ClassifierConfig } from './types.js';

/**
 * Env vars that indicate "this process is part of an agent session." Spec
 * §6.4.2 cooperation ask: agent runtimes export one of these into spawned
 * subprocesses so defenders can attribute file access cleanly.
 */
export const DEFAULT_IDENTITY_ENV_KEYS: ReadonlySet<string> = new Set([
  'CLAUDE_CODE_SESSION',
  'CURSOR_SESSION',
  'AIDER_SESSION',
  'CONTINUE_SESSION',
  'ANTHROPIC_AGENT_RUN',
]);

/**
 * Default classifier config. Conservative — bias toward `unknown` rather than
 * false-positive into agent/pm categories. Users override via
 * ~/.tripwire/agents.yaml and package-managers.yaml at runtime (later PR).
 */
export const DEFAULT_CLASSIFIER_CONFIG: ClassifierConfig = {
  agentPaths: [
    '/Applications/Claude.app/Contents/MacOS/claude-code',
    '/Applications/Cursor.app/Contents/MacOS/Cursor',
    '**/bin/claude-code',
    '**/bin/claude',
    '**/bin/cursor',
    '**/bin/aider',
    '**/bin/continue',
    '**/bin/cline',
  ],
  packageManagerPaths: [
    '**/bin/npm',
    '**/bin/pnpm',
    '**/bin/yarn',
    '**/bin/pip',
    '**/bin/pip3',
    '**/bin/uv',
    // Intentionally NOT in this list: node, python. They run arbitrary code;
    // having them here would over-attribute everything to package-manager-*.
  ],
  shellExes: new Set(['bash', 'zsh', 'fish', 'sh', 'dash']),
};
