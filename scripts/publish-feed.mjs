// Daily IoC feed publisher (runs in the tripwire-feed GitHub Action).
//
// The interesting logic — diffing snapshots, building the manifest, pruning the
// delta chain — lives in @tripwire/feeds (planPublish, unit-tested). This script
// is just the IO around it: seed today's set, load yesterday's, plan, write.
// The workflow handles `gh release upload` + `git commit/push`.
//
// Config via env (all optional): FEED_REPO, FEED_TAG, FEED_DIR, OUT_DIR,
// KEEP_DELTAS, PUBLISH_DATE.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AikidoFeed,
  GhsaFeed,
  CommunityFeed,
  parseManifest,
  parseSnapshot,
  planPublish,
  runSeeder,
} from '../packages/feeds/dist/index.js';

const log = msg => console.log(`[publish-feed] ${msg}`);

function loadConfig(env = process.env) {
  const repo = env.FEED_REPO || 'jmaleonard/tripwire-feed';
  const tag = env.FEED_TAG || 'feed';
  const feedDir = env.FEED_DIR || join(process.cwd(), 'feed-repo');
  const feedV1 = join(feedDir, 'feed', 'v1');
  const date = env.PUBLISH_DATE || new Date().toISOString().slice(0, 10); // empty -> today
  // The snapshot ships under a date-stamped, never-reused name so its CDN URL is
  // always fresh — clobbering one `latest.json` lets Fastly serve a stale copy.
  const snapshotName = `snapshot-${date}.json`;
  return {
    repo,
    date,
    snapshotName,
    keepDeltas: Number(env.KEEP_DELTAS || 30),
    outDir: env.OUT_DIR || join(process.cwd(), 'feed-out'),
    feedV1,
    manifestPath: join(feedV1, 'manifest.json'),
    fullUrl: `https://github.com/${repo}/releases/download/${tag}/${snapshotName}`,
    deltaUrl: date => `https://raw.githubusercontent.com/${repo}/main/feed/v1/delta-${date}.json`,
    deltaPath: date => join(feedV1, `delta-${date}.json`),
  };
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

/** Run the seeder; fail loudly if every source is down. */
async function seedToday() {
  const seed = await runSeeder([
    new AikidoFeed(),
    // GITHUB_TOKEN lifts the advisories API from 60/hr to 5000/hr; the malware
    // corpus needs it. A failing source is logged but won't abort the run.
    new GhsaFeed({ token: process.env.GITHUB_TOKEN }),
    // Approved community reports (moderated): GitHub issues labeled
    // ioc-report + approved, not yet ingested. The workflow marks them ingested
    // after publish so they are not re-added.
    new CommunityFeed({ repo: process.env.FEED_REPO, token: process.env.GITHUB_TOKEN }),
  ]);
  if (!seed.sourceStats.some(s => s.ok)) {
    throw new Error(`all feed sources failed: ${JSON.stringify(seed.sourceStats)}`);
  }
  log(`seeded ${seed.entries.length} IoCs`);
  return seed;
}

/** The previous manifest (from the repo) + snapshot (from the release) to diff against. */
async function loadPrevious(cfg) {
  const manifestJson = readJson(cfg.manifestPath);
  if (!manifestJson) {
    log('no previous manifest; baseline run');
    return { prevManifest: null, prevEntries: [] };
  }
  const prevManifest = parseManifest(manifestJson);
  // Diff against the snapshot the previous manifest points at (its date-stamped URL).
  const snapshotJson = await fetchJson(prevManifest.full.url);
  const prevEntries = snapshotJson ? parseSnapshot(snapshotJson).entries : [];
  log(`previous snapshot: ${prevEntries.length} IoCs`);
  return { prevManifest, prevEntries };
}

/** Write latest.json (for release upload), the manifest, the new delta; drop pruned deltas. */
function writeOutputs(cfg, plan) {
  mkdirSync(cfg.outDir, { recursive: true });
  mkdirSync(cfg.feedV1, { recursive: true });

  // Immutable dated snapshot (the manifest references this) + a clobbered
  // `latest.json` mirror for humans (clients never use it).
  writeFileSync(join(cfg.outDir, cfg.snapshotName), plan.snapshotBody);
  writeFileSync(join(cfg.outDir, 'latest.json'), plan.snapshotBody);
  writeFileSync(cfg.manifestPath, plan.manifestBody);

  if (plan.deltaBody) {
    writeFileSync(cfg.deltaPath(cfg.date), plan.deltaBody);
    log(`delta-${cfg.date}: +${plan.delta.added.length} −${plan.delta.removed.length}`);
  } else {
    log('no delta (baseline run)');
  }

  for (const date of plan.prunedDeltaDates) {
    rmSync(cfg.deltaPath(date), { force: true });
    log(`pruned delta-${date}.json`);
  }
}

async function main() {
  const cfg = loadConfig();
  log(`publishing ${cfg.date} → ${cfg.repo}`);

  const seed = await seedToday();
  const { prevManifest, prevEntries } = await loadPrevious(cfg);

  const plan = planPublish({
    nextEntries: seed.entries,
    prevEntries,
    prevManifest,
    date: cfg.date,
    generatedAt: seed.generatedAt,
    fullUrl: cfg.fullUrl,
    deltaUrl: cfg.deltaUrl,
    keepDeltas: cfg.keepDeltas,
  });

  writeOutputs(cfg, plan);

  const { full, deltas, latest_date } = plan.manifest;
  log(`done: full=${full.count} IoCs, ${deltas.length} deltas, latest=${latest_date}`);
}

main().catch(err => {
  console.error('[publish-feed] failed:', err);
  process.exit(1);
});
