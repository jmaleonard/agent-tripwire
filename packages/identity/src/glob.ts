/**
 * Tiny exe-path matcher. Supports:
 *   - exact match: "/Applications/Claude.app/Contents/MacOS/claude-code"
 *   - env expansion: "${HOME}/.local/share/aider/bin/aider"
 *   - single segment glob: "*\/bin/npm"  (matches "/usr/local/bin/npm")
 *   - any-depth glob: "**\/aider"
 *
 * Sufficient for our config; we are not implementing a full glob library.
 */
export function matchesGlob(path: string, pattern: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const resolved = expandEnv(pattern, env);
  if (!resolved.includes('*')) {
    if (path === resolved) return true;
    return basenameFallback(path, resolved);
  }
  const regex = globToRegex(resolved);
  if (regex.test(path)) return true;
  return basenameFallback(path, resolved);
}

/**
 * When the input is a bare basename (no '/') — which happens on macOS where
 * `ps` can't expose absolute exe paths — match it against the pattern's
 * trailing segment. Lets `**\/bin/npm` match a process reported as just `npm`.
 *
 * Only triggers for bare-basename inputs, so full-path mismatches still fail.
 */
function basenameFallback(path: string, pattern: string): boolean {
  if (path.includes('/') || path.length === 0) return false;
  const segmentStart = pattern.lastIndexOf('/') + 1;
  const lastSegment = pattern.slice(segmentStart);
  if (!lastSegment.includes('*')) return lastSegment === path;
  const segRegex = new RegExp(`^${lastSegment.replace(/\*+/g, '.*')}$`);
  return segRegex.test(path);
}

export function matchesAnyGlob(
  path: string,
  patterns: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  for (const p of patterns) {
    if (matchesGlob(path, p, env)) return true;
  }
  return false;
}

function expandEnv(pattern: string, env: NodeJS.ProcessEnv): string {
  return pattern.replace(/\$\{(\w+)\}/g, (_, key) => env[key] ?? '');
}

function globToRegex(pattern: string): RegExp {
  // Escape regex metachars except *, then replace ** -> .* and * -> [^/]*.
  // Order matters: replace ** first, then *.
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
      } else {
        out += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(ch)) {
      out += '\\' + ch;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}
