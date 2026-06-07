// Build the public "top offenders" GitHub Pages site from the published IoC
// feed. Runs in the tripwire-feed GitHub Action (after the feed is published)
// and deploys the result to Pages.
//
// The ranking + HTML live in @tripwire/feeds (computeTopOffenders /
// renderTopOffendersHtml, unit-tested). This script is just the IO: fetch the
// manifest, download + verify the snapshot, render, write.
//
// Config via env (all optional):
//   MANIFEST_URL  feed manifest (default: the public tripwire-feed repo)
//   SITE_DIR      output dir (default: ./site)
//   PROJECT_URL   link back to the project

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeTopOffenders,
  parseManifest,
  parseSnapshot,
  renderTopOffendersHtml,
  sha256Hex,
} from '../packages/feeds/dist/index.js';

const log = msg => console.log(`[build-site] ${msg}`);

const MANIFEST_URL =
  process.env.MANIFEST_URL ||
  'https://raw.githubusercontent.com/jmaleonard/tripwire-feed/main/feed/v1/manifest.json';
const SITE_DIR = process.env.SITE_DIR || join(process.cwd(), 'site');
const PROJECT_URL = process.env.PROJECT_URL || 'https://github.com/jmaleonard/agent-tripwire';

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.text();
}

async function main() {
  log(`manifest: ${MANIFEST_URL}`);
  const manifest = parseManifest(JSON.parse(await fetchText(MANIFEST_URL)));

  log(`snapshot: ${manifest.full.url}`);
  const body = await fetchText(manifest.full.url);
  const actual = sha256Hex(body);
  if (actual !== manifest.full.sha256) {
    throw new Error(`snapshot integrity check failed: ${actual} != ${manifest.full.sha256}`);
  }
  const snapshot = parseSnapshot(JSON.parse(body));

  const report = computeTopOffenders(snapshot.entries);
  const html = renderTopOffendersHtml(report, { feedDate: snapshot.date, projectUrl: PROJECT_URL });

  mkdirSync(SITE_DIR, { recursive: true });
  writeFileSync(join(SITE_DIR, 'index.html'), html);
  writeFileSync(join(SITE_DIR, 'top-offenders.json'), `${JSON.stringify(report, null, 2)}\n`);

  log(
    `wrote ${SITE_DIR}/ — ${report.totalPackages} packages, ` +
      `${report.campaigns.length} campaigns, snapshot ${snapshot.date}`,
  );
}

main().catch(err => {
  console.error(`[build-site] ${err.message}`);
  process.exit(1);
});
