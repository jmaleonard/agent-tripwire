import type { CampaignSummary, TopOffenderEntry, TopOffendersReport } from './top-offenders.js';

export interface RenderSiteMeta {
  /** Snapshot date the report was built from (YYYY-MM-DD), if known. */
  feedDate?: string;
  /** Link back to the project. */
  projectUrl?: string;
}

/**
 * Render the top-offenders report as a single self-contained HTML page — inline
 * CSS, no scripts, no external assets — suitable for GitHub Pages. Pure.
 */
export function renderTopOffendersHtml(report: TopOffendersReport, meta: RenderSiteMeta = {}): string {
  const project = meta.projectUrl ?? 'https://github.com/jmaleonard/agent-tripwire';
  const ecoLine = Object.entries(report.ecosystems)
    .sort((a, b) => b[1] - a[1])
    .map(([eco, n]) => `${esc(eco)} ${fmtInt(n)}`)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>tripwire — top offenders</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem 4rem;
  background: #0d1117; color: #e6edf3;
  font: 15px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; border-bottom: 1px solid #30363d; padding-bottom: .35rem; }
a { color: #58a6ff; }
.sub { color: #8b949e; margin: 0 0 1.5rem; }
.stats { display: flex; flex-wrap: wrap; gap: .5rem 1.25rem; margin: 1rem 0; color: #8b949e; }
.stats b { color: #e6edf3; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .4rem .6rem; border-bottom: 1px solid #21262d; vertical-align: top; }
th { color: #8b949e; font-weight: 600; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.pkg { color: #ffa657; }
.eco { color: #8b949e; }
.camp { color: #ff7b72; }
.src { color: #7ee787; }
.muted { color: #8b949e; }
footer { margin-top: 3rem; color: #8b949e; font-size: .85rem; }
.empty { color: #8b949e; font-style: italic; }
</style>
</head>
<body>
<main>
  <h1>tripwire · top offenders</h1>
  <p class="sub">Packages on the public malware feed tripwire enriches events against.
  Detection-only awareness — not an accusation of any maintainer.</p>

  <div class="stats">
    <span><b>${fmtInt(report.totalPackages)}</b> packages</span>
    <span><b>${fmtInt(report.totalIocs)}</b> flagged versions</span>
    <span><b>${report.campaigns.length}</b> campaigns shown</span>
    ${ecoLine ? `<span>${ecoLine}</span>` : ''}
  </div>

  <h2>🆕 Most recently flagged</h2>
  ${entriesTable(report.newest, 'first seen')}

  <h2>🎯 Biggest campaigns</h2>
  ${campaignsTable(report.campaigns)}

  ${
    // Only meaningful once entries are corroborated by more than one feed.
    // With a single-source feed this ranking is noise, so omit it entirely.
    report.mostSourced.some(e => e.sources.length >= 2)
      ? `<h2>🛡️ Highest confidence (flagged by the most sources)</h2>
  ${entriesTable(report.mostSourced, 'last seen')}`
      : ''
  }

  <footer>
    Generated ${esc(report.generatedAt)}${meta.feedDate ? ` from snapshot ${esc(meta.feedDate)}` : ''}.
    Source: <a href="${esc(project)}">agent-tripwire</a> ·
    feed data from Aikido / OSV / GitHub Advisory.
  </footer>
</main>
</body>
</html>
`;
}

function entriesTable(rows: ReadonlyArray<TopOffenderEntry>, dateLabel: string): string {
  if (rows.length === 0) return `<p class="empty">Nothing to show.</p>`;
  const body = rows
    .map(
      r => `<tr>
      <td><span class="eco">${esc(r.ecosystem)}</span> <span class="pkg">${esc(r.package)}</span></td>
      <td class="num">${fmtInt(r.versions)}</td>
      <td><span class="src">${r.sources.map(esc).join(', ') || '—'}</span></td>
      <td>${r.campaign ? `<span class="camp">${esc(r.campaign)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="muted">${esc(dateOnly(dateLabel === 'first seen' ? r.firstSeen : r.lastSeen))}</td>
    </tr>`,
    )
    .join('\n');
  return `<table>
    <thead><tr>
      <th>package</th><th class="num">versions</th><th>sources</th><th>campaign</th><th>${esc(dateLabel)}</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function campaignsTable(rows: ReadonlyArray<CampaignSummary>): string {
  if (rows.length === 0) return `<p class="empty">No campaign-attributed packages yet.</p>`;
  const body = rows
    .map(
      r => `<tr>
      <td><span class="camp">${esc(r.campaign)}</span></td>
      <td class="num">${fmtInt(r.packages)}</td>
      <td class="eco">${r.ecosystems.map(esc).join(', ')}</td>
      <td class="muted">${r.examples.map(esc).join(', ')}</td>
    </tr>`,
    )
    .join('\n');
  return `<table>
    <thead><tr>
      <th>campaign</th><th class="num">packages</th><th>ecosystems</th><th>examples</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function dateOnly(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
