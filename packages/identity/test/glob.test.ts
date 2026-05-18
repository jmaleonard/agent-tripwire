import { describe, expect, it } from 'vitest';
import { matchesAnyGlob, matchesGlob } from '../src/glob.js';

describe('matchesGlob', () => {
  it('exact match', () => {
    expect(matchesGlob('/usr/local/bin/npm', '/usr/local/bin/npm')).toBe(true);
    expect(matchesGlob('/usr/local/bin/yarn', '/usr/local/bin/npm')).toBe(false);
  });

  it('single-segment star', () => {
    expect(matchesGlob('/usr/local/bin/npm', '*/bin/npm')).toBe(false); // * doesn't cross /
    expect(matchesGlob('/usr/bin/npm', 'a*c/bin/npm')).toBe(false);
    expect(matchesGlob('aXc/bin/npm', 'a*c/bin/npm')).toBe(true);
  });

  it('double-star matches across path separators', () => {
    expect(matchesGlob('/usr/local/bin/npm', '**/bin/npm')).toBe(true);
    expect(matchesGlob('/opt/homebrew/Cellar/node@22/bin/npm', '**/bin/npm')).toBe(true);
  });

  it('env var expansion', () => {
    const env = { HOME: '/Users/me' };
    expect(matchesGlob('/Users/me/.local/bin/aider', '${HOME}/.local/bin/aider', env)).toBe(true);
    expect(matchesGlob('/Users/other/.local/bin/aider', '${HOME}/.local/bin/aider', env)).toBe(false);
  });

  it('missing env var expands to empty', () => {
    expect(matchesGlob('/.foo', '${MISSING_VAR_XYZ}/.foo', {})).toBe(true);
  });

  describe('basename fallback (platform with no absolute paths, e.g. macOS ps)', () => {
    it('bare basename matches the pattern trailing segment', () => {
      expect(matchesGlob('npm', '**/bin/npm')).toBe(true);
      expect(matchesGlob('claude', '**/bin/claude')).toBe(true);
      expect(matchesGlob('node', '**/bin/npm')).toBe(false);
    });

    it('matches when pattern has no glob and bare basename equals trailing segment', () => {
      expect(matchesGlob('claude-code', '/Applications/Claude.app/Contents/MacOS/claude-code')).toBe(true);
      expect(matchesGlob('Cursor', '/Applications/Cursor.app/Contents/MacOS/Cursor')).toBe(true);
    });

    it('does NOT trigger for full-path inputs that miss', () => {
      expect(matchesGlob('/usr/local/bin/python', '**/bin/npm')).toBe(false);
    });

    it('empty path does not match', () => {
      expect(matchesGlob('', '**/bin/npm')).toBe(false);
    });
  });
});

describe('matchesAnyGlob', () => {
  it('matches when any pattern matches', () => {
    const patterns = ['**/bin/npm', '**/bin/pnpm', '**/bin/yarn'];
    expect(matchesAnyGlob('/usr/local/bin/pnpm', patterns)).toBe(true);
    expect(matchesAnyGlob('/usr/local/bin/python', patterns)).toBe(false);
  });

  it('returns false for empty pattern list', () => {
    expect(matchesAnyGlob('/anything', [])).toBe(false);
  });
});
