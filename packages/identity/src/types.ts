/** Raw process info read from the platform (Linux /proc, macOS ps, mock). */
export interface RawProcess {
  pid: number;
  ppid: number;
  /** Canonical executable path. May be empty on platforms that don't expose it. */
  exe: string;
  argv: string[];
  /** Environment variables. Empty when the platform doesn't expose env (macOS in v1). */
  env: Record<string, string>;
}

/** A single rung in the parent chain. */
export interface AncestryNode {
  pid: number;
  exe: string;
  argv: string[];
  /** Subset of env vars matching the identity-marker allowlist (CLAUDE_CODE_SESSION etc.). */
  identityEnv: Record<string, string>;
}

/** The ancestry chain, root (PID 1 / earliest ancestor) first, firing process last. */
export type Ancestry = AncestryNode[];

/** Platform-specific reader. Implementations: Linux (/proc), macOS (ps), mock. */
export interface ProcessReader {
  /** Read info for a pid. Returns null when the process doesn't exist. */
  read(pid: number): Promise<RawProcess | null>;
}

export interface ClassifierConfig {
  /** Glob patterns that match known agent binaries. */
  agentPaths: ReadonlyArray<string>;
  /** Glob patterns that match known package managers. */
  packageManagerPaths: ReadonlyArray<string>;
  /** Basename set of interactive shells (zsh, bash, fish, sh, dash). */
  shellExes: ReadonlySet<string>;
}
