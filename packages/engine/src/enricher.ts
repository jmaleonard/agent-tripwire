import type { IoCAttribution, IoCEntry, PackageRef } from '@tripwire/shared';
import type { IoCRepository } from '@tripwire/store';

/**
 * Best-effort package attribution from a process exe path. Returns the package
 * that *contains* the firing executable, if any.
 *
 *   .../node_modules/some-pkg/lib/cli.js          → npm:some-pkg
 *   .../node_modules/@scope/pkg/index.js          → npm:@scope/pkg
 *   .../site-packages/requests/__init__.py        → pypi:requests
 *   /usr/local/bin/aws                            → null
 *
 * Version is not extracted (would require reading the nearest package.json /
 * METADATA file). The IoC lookup ignores version anyway in v1; when we add
 * version-specific IoCs the loader can fill this in.
 */
export function attributePackage(processPath: string): PackageRef | null {
  if (!processPath) return null;

  const npm = processPath.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
  if (npm?.[1]) {
    return { ecosystem: 'npm', name: npm[1], version: 'unknown' };
  }

  const py = processPath.match(/\/site-packages\/([^/]+)\//);
  if (py?.[1]) {
    return { ecosystem: 'pypi', name: py[1], version: 'unknown' };
  }

  return null;
}

/**
 * Attach IoC attribution to a package ref by looking up the IoCRepository.
 * Returns the ref unchanged when no IoC matches.
 */
export function enrichWithIoc(pkg: PackageRef, repo: IoCRepository): PackageRef {
  const matches = repo.lookup(pkg.ecosystem, pkg.name);
  if (matches.length === 0) return pkg;

  const attribution = collectAttribution(matches);
  if (attribution.length === 0) return pkg;
  return { ...pkg, ioc_attribution: attribution };
}

function collectAttribution(matches: ReadonlyArray<IoCEntry>): IoCAttribution[] {
  const seen = new Set<string>();
  const out: IoCAttribution[] = [];
  for (const entry of matches) {
    for (const source of entry.sources) {
      const key = `${source.name}\0${entry.campaign ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        source: source.name,
        ...(entry.campaign !== undefined ? { campaign: entry.campaign } : {}),
      });
    }
  }
  return out;
}
