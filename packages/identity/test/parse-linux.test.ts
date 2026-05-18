import { describe, expect, it } from 'vitest';
import {
  parseCmdline,
  parseEnviron,
  parseStatusPpid,
  parseStatusUid,
} from '../src/parse-linux.js';

describe('parseStatusPpid', () => {
  it('extracts PPid line', () => {
    const status = `Name:\ttest\nState:\tR (running)\nPPid:\t4420\nUid:\t1000\t1000\t1000\t1000\n`;
    expect(parseStatusPpid(status)).toBe(4420);
  });

  it('returns 0 when PPid line is missing', () => {
    expect(parseStatusPpid('Name:\ttest\n')).toBe(0);
  });
});

describe('parseStatusUid', () => {
  it('extracts real UID', () => {
    const status = `Uid:\t1000\t1000\t1000\t1000\n`;
    expect(parseStatusUid(status)).toBe(1000);
  });
});

describe('parseCmdline', () => {
  it('splits on null bytes', () => {
    const buf = Buffer.from('node\0./postinstall.js\0--verbose\0');
    expect(parseCmdline(buf)).toEqual(['node', './postinstall.js', '--verbose']);
  });

  it('handles missing trailing null', () => {
    expect(parseCmdline(Buffer.from('node\0./script.js'))).toEqual(['node', './script.js']);
  });

  it('empty input', () => {
    expect(parseCmdline(Buffer.alloc(0))).toEqual([]);
  });

  it('all nulls returns empty', () => {
    expect(parseCmdline(Buffer.from('\0\0\0'))).toEqual([]);
  });
});

describe('parseEnviron', () => {
  it('parses null-separated KEY=VALUE pairs', () => {
    const buf = Buffer.from('PATH=/usr/bin\0HOME=/Users/me\0CLAUDE_CODE_SESSION=abc123\0');
    expect(parseEnviron(buf)).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      CLAUDE_CODE_SESSION: 'abc123',
    });
  });

  it('skips malformed entries without =', () => {
    const buf = Buffer.from('PATH=/usr/bin\0MALFORMED\0HOME=/x\0');
    expect(parseEnviron(buf)).toEqual({ PATH: '/usr/bin', HOME: '/x' });
  });

  it('preserves = in values', () => {
    const buf = Buffer.from('CONNECTION=key=value\0');
    expect(parseEnviron(buf)).toEqual({ CONNECTION: 'key=value' });
  });

  it('empty input', () => {
    expect(parseEnviron(Buffer.alloc(0))).toEqual({});
  });
});
