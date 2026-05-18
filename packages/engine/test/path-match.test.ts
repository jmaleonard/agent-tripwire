import { describe, expect, it } from 'vitest';
import { matchesPath } from '../src/path-match.js';

const HOME = '/Users/test';

describe('matchesPath', () => {
  it('home_relative matches the exact path and any descendant', () => {
    const p = { home_relative: ['.aws/credentials'] };
    expect(matchesPath(`${HOME}/.aws/credentials`, p, { home: HOME })).toBe(true);
    expect(matchesPath(`${HOME}/.aws/credentials/other`, p, { home: HOME })).toBe(true);
    expect(matchesPath(`${HOME}/.aws/config`, p, { home: HOME })).toBe(false);
    expect(matchesPath('/other/.aws/credentials', p, { home: HOME })).toBe(false);
  });

  it('home_relative path is matched against the user-supplied home', () => {
    const p = { home_relative: ['.ssh/id_rsa'] };
    expect(matchesPath('/Users/A/.ssh/id_rsa', p, { home: '/Users/A' })).toBe(true);
    expect(matchesPath('/Users/B/.ssh/id_rsa', p, { home: '/Users/A' })).toBe(false);
  });

  it('starts_with matches a prefix', () => {
    const p = { starts_with: ['/etc/'] };
    expect(matchesPath('/etc/passwd', p, { home: HOME })).toBe(true);
    expect(matchesPath('/var/log', p, { home: HOME })).toBe(false);
  });

  it('starts_with expands ~/ prefix to home', () => {
    const p = { starts_with: ['~/.config/'] };
    expect(matchesPath(`${HOME}/.config/claude/settings.json`, p, { home: HOME })).toBe(true);
    expect(matchesPath('/etc/.config/x', p, { home: HOME })).toBe(false);
  });

  it('equals does literal match', () => {
    const p = { equals: ['/etc/passwd'] };
    expect(matchesPath('/etc/passwd', p, { home: HOME })).toBe(true);
    expect(matchesPath('/etc/passwd2', p, { home: HOME })).toBe(false);
  });

  it('glob double-star spans path separators', () => {
    const p = { glob: ['**/.claude/settings.json'] };
    expect(matchesPath('/Users/test/projects/x/.claude/settings.json', p, { home: HOME })).toBe(true);
    expect(matchesPath('/Users/test/.claude/settings.json', p, { home: HOME })).toBe(true);
    expect(matchesPath('/Users/test/.claude/other.json', p, { home: HOME })).toBe(false);
  });

  it('glob single-star does not span path separators', () => {
    const p = { glob: ['/Users/*/file'] };
    expect(matchesPath('/Users/alice/file', p, { home: HOME })).toBe(true);
    expect(matchesPath('/Users/alice/sub/file', p, { home: HOME })).toBe(false);
  });

  it('glob ~ expansion', () => {
    const p = { glob: ['~/.config/**/secrets.json'] };
    expect(matchesPath(`${HOME}/.config/claude/secrets.json`, p, { home: HOME })).toBe(true);
    expect(matchesPath(`${HOME}/.config/secrets.json`, p, { home: HOME })).toBe(true);
  });

  it('multiple predicates OR together', () => {
    const p = { home_relative: ['.aws'], starts_with: ['/etc/'] };
    expect(matchesPath(`${HOME}/.aws/credentials`, p, { home: HOME })).toBe(true);
    expect(matchesPath('/etc/passwd', p, { home: HOME })).toBe(true);
    expect(matchesPath('/var/log', p, { home: HOME })).toBe(false);
  });

  it('empty predicate matches nothing', () => {
    expect(matchesPath('/anything', {}, { home: HOME })).toBe(false);
  });
});
