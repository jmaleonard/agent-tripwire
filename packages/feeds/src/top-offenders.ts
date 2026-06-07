import type { IoCEntry } from '@tripwire/shared';

/** A package aggregated across all its flagged versions. */
export interface TopOffenderEntry {
  ecosystem: string;
  package: string;
  /** Number of distinct flagged version specs for this package. */
  versions: number;
  /** Distinct source feeds that flagged it (e.g. aikido, osv). */
  sources: string[];
  campaign: string | null;
  firstSeen: string;
  lastSeen: string;
}

export interface CampaignSummary {
  campaign: string;
  /** Distinct packages attributed to the campaign. */
  packages: number;
  ecosystems: string[];
  /** A handful of example package names. */
  examples: string[];
}

export interface TopOffendersReport {
  generatedAt: string;
  totalIocs: number;
  totalPackages: number;
  ecosystems: Record<string, number>;
  /** Most recently flagged packages (by first_seen). */
  newest: TopOffenderEntry[];
  /** Largest campaigns by distinct package count. */
  campaigns: CampaignSummary[];
  /** Highest-confidence: flagged by the most distinct sources. */
  mostSourced: TopOffenderEntry[];
}

export interface TopOffendersOptions {
  now?: Date;
  /** Rows per section. Default 25. */
  limit?: number;
  /** Example package names per campaign. Default 5. */
  campaignExamples?: number;
}

interface PackageAgg {
  ecosystem: string;
  package: string;
  versions: Set<string>;
  sources: Set<string>;
  campaign: string | null;
  firstSeen: string;
  lastSeen: string;
}

/**
 * Roll the per-(ecosystem, package, version) IoC feed up into a public
 * "top offenders" report: most recently flagged, biggest campaigns, and the
 * highest-confidence (multi-source) packages. Pure — no IO.
 */
export function computeTopOffenders(
  entries: ReadonlyArray<IoCEntry>,
  opts: TopOffendersOptions = {},
): TopOffendersReport {
  const limit = opts.limit ?? 25;
  const exampleCount = opts.campaignExamples ?? 5;
  const now = opts.now ?? new Date();

  const byPackage = new Map<string, PackageAgg>();
  const ecosystems: Record<string, number> = {};

  for (const e of entries) {
    const key = `${e.ecosystem}:${e.package}`;
    let agg = byPackage.get(key);
    if (!agg) {
      agg = {
        ecosystem: e.ecosystem,
        package: e.package,
        versions: new Set(),
        sources: new Set(),
        campaign: e.campaign ?? null,
        firstSeen: e.first_seen,
        lastSeen: e.last_seen,
      };
      byPackage.set(key, agg);
    }
    agg.versions.add(e.version_spec);
    for (const s of e.sources) agg.sources.add(s.name);
    if (!agg.campaign && e.campaign) agg.campaign = e.campaign;
    if (e.first_seen < agg.firstSeen) agg.firstSeen = e.first_seen;
    if (e.last_seen > agg.lastSeen) agg.lastSeen = e.last_seen;
  }

  const packages = [...byPackage.values()];
  for (const p of packages) ecosystems[p.ecosystem] = (ecosystems[p.ecosystem] ?? 0) + 1;

  const toEntry = (p: PackageAgg): TopOffenderEntry => ({
    ecosystem: p.ecosystem,
    package: p.package,
    versions: p.versions.size,
    sources: [...p.sources].sort(),
    campaign: p.campaign,
    firstSeen: p.firstSeen,
    lastSeen: p.lastSeen,
  });

  const newest = [...packages]
    .sort((a, b) => cmp(b.firstSeen, a.firstSeen) || cmp(b.lastSeen, a.lastSeen))
    .slice(0, limit)
    .map(toEntry);

  const mostSourced = [...packages]
    .filter(p => p.sources.size > 0)
    .sort(
      (a, b) =>
        b.sources.size - a.sources.size ||
        b.versions.size - a.versions.size ||
        cmp(b.lastSeen, a.lastSeen),
    )
    .slice(0, limit)
    .map(toEntry);

  const campaignMap = new Map<string, PackageAgg[]>();
  for (const p of packages) {
    if (!p.campaign) continue;
    const list = campaignMap.get(p.campaign) ?? [];
    list.push(p);
    campaignMap.set(p.campaign, list);
  }
  const campaigns: CampaignSummary[] = [...campaignMap.entries()]
    .map(([campaign, pkgs]) => ({
      campaign,
      packages: pkgs.length,
      ecosystems: [...new Set(pkgs.map(p => p.ecosystem))].sort(),
      examples: pkgs
        .slice()
        .sort((a, b) => cmp(b.lastSeen, a.lastSeen))
        .slice(0, exampleCount)
        .map(p => p.package),
    }))
    .sort((a, b) => b.packages - a.packages || a.campaign.localeCompare(b.campaign))
    .slice(0, limit);

  return {
    generatedAt: now.toISOString(),
    totalIocs: entries.length,
    totalPackages: packages.length,
    ecosystems,
    newest,
    campaigns,
    mostSourced,
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
