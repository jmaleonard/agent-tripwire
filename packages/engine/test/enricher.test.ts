import type { IoCEntry } from '@tripwire/shared';
import { IoCRepository, openDb, type DbHandle } from '@tripwire/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attributePackage, enrichWithIoc } from '../src/enricher.js';

describe('attributePackage', () => {
  it('detects npm package from node_modules path', () => {
    expect(attributePackage('/project/node_modules/some-pkg/lib/cli.js')).toEqual({
      ecosystem: 'npm',
      name: 'some-pkg',
      version: 'unknown',
    });
  });

  it('detects scoped npm package', () => {
    expect(attributePackage('/project/node_modules/@scope/pkg/index.js')).toEqual({
      ecosystem: 'npm',
      name: '@scope/pkg',
      version: 'unknown',
    });
  });

  it('detects pypi package from site-packages path', () => {
    expect(attributePackage('/venv/lib/python3.12/site-packages/requests/__init__.py')).toEqual({
      ecosystem: 'pypi',
      name: 'requests',
      version: 'unknown',
    });
  });

  it('handles deeply nested node_modules (the outer one wins)', () => {
    expect(
      attributePackage('/project/node_modules/outer-pkg/node_modules/inner/x.js'),
    ).toEqual({
      ecosystem: 'npm',
      name: 'outer-pkg',
      version: 'unknown',
    });
  });

  it('returns null when no package container is found', () => {
    expect(attributePackage('/usr/local/bin/aws')).toBeNull();
    expect(attributePackage('')).toBeNull();
  });
});

describe('enrichWithIoc', () => {
  let db: DbHandle;
  let repo: IoCRepository;

  beforeEach(() => {
    db = openDb({ path: ':memory:' });
    repo = new IoCRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  function seed(entries: IoCEntry[]): void {
    repo.upsert(entries);
  }

  it('returns the package unchanged when no IoC matches', () => {
    const pkg = { ecosystem: 'npm' as const, name: 'clean-pkg', version: '1.0.0' };
    expect(enrichWithIoc(pkg, repo)).toEqual(pkg);
  });

  it('attaches IoC attribution when a match exists', () => {
    seed([
      {
        ecosystem: 'npm',
        package: 'node-ipc',
        version_spec: '12.0.1',
        sources: [{ name: 'aikido' }],
        campaign: 'node-ipc-2026-05',
        first_seen: '2026-05-14T12:00:00.000Z',
        last_seen: '2026-05-14T12:00:00.000Z',
      },
    ]);
    const enriched = enrichWithIoc(
      { ecosystem: 'npm', name: 'node-ipc', version: 'unknown' },
      repo,
    );
    expect(enriched.ioc_attribution).toEqual([
      { source: 'aikido', campaign: 'node-ipc-2026-05' },
    ]);
  });

  it('dedupes attribution by (source, campaign)', () => {
    seed([
      {
        ecosystem: 'npm',
        package: 'p',
        version_spec: '1.0.0',
        sources: [{ name: 'aikido' }, { name: 'osv' }],
        campaign: 'campaign-a',
        first_seen: 'x',
        last_seen: 'x',
      },
      {
        ecosystem: 'npm',
        package: 'p',
        version_spec: '2.0.0',
        sources: [{ name: 'aikido' }],
        campaign: 'campaign-a',
        first_seen: 'x',
        last_seen: 'x',
      },
    ]);
    const enriched = enrichWithIoc(
      { ecosystem: 'npm', name: 'p', version: 'unknown' },
      repo,
    );
    expect(enriched.ioc_attribution).toEqual([
      { source: 'aikido', campaign: 'campaign-a' },
      { source: 'osv', campaign: 'campaign-a' },
    ]);
  });

  it('does not cross ecosystems', () => {
    seed([
      {
        ecosystem: 'pypi',
        package: 'samename',
        version_spec: '1.0.0',
        sources: [{ name: 'aikido' }],
        first_seen: 'x',
        last_seen: 'x',
      },
    ]);
    const enriched = enrichWithIoc(
      { ecosystem: 'npm', name: 'samename', version: 'unknown' },
      repo,
    );
    expect(enriched.ioc_attribution).toBeUndefined();
  });
});
