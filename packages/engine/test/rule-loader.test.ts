import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadRulesFromDirectory,
  parseRulesYaml,
  RuleValidationError,
} from '../src/rule-loader.js';

const VALID_RULE_YAML = `
id: cred.aws-credentials-read
name: AWS credentials file read
severity: high
category: credential-access
description: A process read ~/.aws/credentials.
applies_to:
  event_kind: [read]
  path:
    home_relative: [.aws/credentials]
  ancestry_category:
    not_in: [human-shell]
`;

describe('parseRulesYaml', () => {
  it('parses a single rule object', () => {
    const rules = parseRulesYaml(VALID_RULE_YAML);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('cred.aws-credentials-read');
    expect(rules[0]!.severity).toBe('high');
  });

  it('parses an array of rules', () => {
    const yaml = `
- ${VALID_RULE_YAML.trim().split('\n').join('\n  ')}
- id: cred.ssh-private-key-read
  name: SSH private key read
  severity: critical
  category: credential-access
  description: SSH private key was read.
  applies_to:
    event_kind: [read]
`;
    const rules = parseRulesYaml(yaml);
    expect(rules).toHaveLength(2);
    expect(rules.map(r => r.id)).toEqual([
      'cred.aws-credentials-read',
      'cred.ssh-private-key-read',
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(parseRulesYaml('')).toEqual([]);
    expect(parseRulesYaml('null')).toEqual([]);
  });

  it('throws on missing required field', () => {
    expect(() => parseRulesYaml('id: cred.test\n')).toThrow(RuleValidationError);
  });

  it('throws on invalid id pattern', () => {
    expect(() =>
      parseRulesYaml(`
id: not-a-valid-id
name: x
severity: high
category: credential-access
description: x
applies_to: {}
`),
    ).toThrow(/invalid id/);
  });

  it('throws on invalid severity', () => {
    expect(() =>
      parseRulesYaml(`
id: cred.x
name: x
severity: catastrophic
category: credential-access
description: x
applies_to: {}
`),
    ).toThrow(/invalid severity/);
  });

  it('throws on invalid category', () => {
    expect(() =>
      parseRulesYaml(`
id: cred.x
name: x
severity: high
category: weather
description: x
applies_to: {}
`),
    ).toThrow(/invalid category/);
  });

  it('includes the source path in the error when provided', () => {
    expect(() => parseRulesYaml('id: bad\n', '/etc/rules.yaml')).toThrow(/\/etc\/rules\.yaml/);
  });
});

describe('loadRulesFromDirectory', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tripwire-rules-test-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads .yaml files in sorted order, skips other files', () => {
    writeFileSync(join(dir, 'b.yaml'), VALID_RULE_YAML);
    writeFileSync(
      join(dir, 'a.yaml'),
      VALID_RULE_YAML.replace('cred.aws-credentials-read', 'cred.ssh-private-key-read'),
    );
    writeFileSync(join(dir, 'README.md'), '# ignore me');
    return loadRulesFromDirectory(dir).then(rules => {
      expect(rules.map(r => r.id)).toEqual([
        'cred.ssh-private-key-read',
        'cred.aws-credentials-read',
      ]);
    });
  });

  it('returns empty array when directory has no yaml files', async () => {
    expect(await loadRulesFromDirectory(dir)).toEqual([]);
  });
});
