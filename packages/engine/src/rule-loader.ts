import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Rule } from '@tripwire/shared';
import { parse as parseYaml } from 'yaml';

const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const CATEGORIES = new Set([
  'credential-access',
  'persistence',
  'defense-evasion',
  'exfiltration',
  'metadata',
]);
const ID_PATTERN = /^(ioc|cred|persist|net|meta)\.[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export class RuleValidationError extends Error {
  constructor(message: string, public readonly source?: string) {
    super(source ? `${source}: ${message}` : message);
    this.name = 'RuleValidationError';
  }
}

/**
 * Parse a YAML string into Rules. The document may be a single rule object or
 * an array of rule objects. Each is structurally validated against the v1
 * rule shape; richer JSON-Schema validation can layer on later.
 */
export function parseRulesYaml(yaml: string, source?: string): Rule[] {
  const doc = parseYaml(yaml);
  if (doc === null || doc === undefined) return [];
  const items = Array.isArray(doc) ? doc : [doc];
  return items.map(item => validateRule(item, source));
}

export async function loadRulesFromDirectory(dir: string): Promise<Rule[]> {
  const entries = await readdir(dir);
  const out: Rule[] = [];
  for (const name of entries.sort()) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const full = join(dir, name);
    const content = await readFile(full, 'utf-8');
    out.push(...parseRulesYaml(content, full));
  }
  return out;
}

function validateRule(value: unknown, source: string | undefined): Rule {
  if (typeof value !== 'object' || value === null) {
    throw new RuleValidationError('rule must be an object', source);
  }
  const r = value as Record<string, unknown>;
  const required = ['id', 'name', 'severity', 'category', 'description', 'applies_to'];
  for (const key of required) {
    if (!(key in r)) {
      throw new RuleValidationError(`missing required field: ${key}`, source);
    }
  }
  if (typeof r.id !== 'string' || !ID_PATTERN.test(r.id)) {
    throw new RuleValidationError(`invalid id: ${String(r.id)}`, source);
  }
  if (typeof r.name !== 'string' || r.name.length === 0) {
    throw new RuleValidationError('name must be a non-empty string', source);
  }
  if (typeof r.severity !== 'string' || !SEVERITIES.has(r.severity)) {
    throw new RuleValidationError(`invalid severity: ${String(r.severity)}`, source);
  }
  if (typeof r.category !== 'string' || !CATEGORIES.has(r.category)) {
    throw new RuleValidationError(`invalid category: ${String(r.category)}`, source);
  }
  if (typeof r.description !== 'string' || r.description.length === 0) {
    throw new RuleValidationError('description must be a non-empty string', source);
  }
  if (typeof r.applies_to !== 'object' || r.applies_to === null) {
    throw new RuleValidationError('applies_to must be an object', source);
  }
  return r as unknown as Rule;
}
