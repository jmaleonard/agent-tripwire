import { homedir } from 'node:os';
import type { PathPredicate } from '@tripwire/shared';

export interface PathMatchOptions {
  /** Override $HOME (for tests + multi-user scenarios). Defaults to os.homedir(). */
  home?: string;
}

/**
 * Match an absolute filesystem path against a rule's PathPredicate.
 * Any sub-predicate matching causes the whole predicate to match (OR'd).
 *
 *   home_relative: ".aws/credentials"  → ~/.aws/credentials (and any descendant)
 *   starts_with:   "~/.config/claude"  → ~/.config/claude...
 *   equals:        "/etc/passwd"       → exact
 *   glob:          "**\/.claude/settings.json"  → glob match
 */
export function matchesPath(
  path: string,
  predicate: PathPredicate,
  opts: PathMatchOptions = {},
): boolean {
  const home = opts.home ?? homedir();

  if (predicate.equals?.includes(path)) return true;

  if (predicate.home_relative?.length) {
    for (const rel of predicate.home_relative) {
      const full = `${home}/${rel}`;
      if (path === full || path.startsWith(`${full}/`)) return true;
    }
  }

  if (predicate.starts_with?.length) {
    for (const sw of predicate.starts_with) {
      const expanded = expandTilde(sw, home);
      if (path.startsWith(expanded)) return true;
    }
  }

  if (predicate.glob?.length) {
    for (const g of predicate.glob) {
      if (matchesGlobPath(path, expandTilde(g, home))) return true;
    }
  }

  return false;
}

function expandTilde(pattern: string, home: string): string {
  if (pattern === '~') return home;
  if (pattern.startsWith('~/')) return `${home}/${pattern.slice(2)}`;
  return pattern;
}

function matchesGlobPath(path: string, pattern: string): boolean {
  return globToRegex(pattern).test(path);
}

function globToRegex(pattern: string): RegExp {
  const SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']', '\\']);
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*' && pattern[i + 2] === '/') {
      // **/ matches zero-or-more path segments (standard glob semantics).
      out += '(?:.*\\/)?';
      i += 3;
    } else if (c === '*' && pattern[i + 1] === '*') {
      out += '.*';
      i += 2;
    } else if (c === '*') {
      out += '[^/]*';
      i++;
    } else if (c === '?') {
      out += '[^/]';
      i++;
    } else if (SPECIAL.has(c)) {
      out += '\\' + c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return new RegExp(`^${out}$`);
}
