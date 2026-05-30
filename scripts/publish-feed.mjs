// Daily IoC feed publisher. Runs in GitHub Actions; see
// .github/workflows/seed-feed.yml. Pure planning lives in @tripwire/feeds
// (planPublish, tested); this script is the IO around it.
//
// What it does:
//   1. Runs the seeder (Aikido npm + PyPI) → today's merged IoC set.
//   2. Downloads the previous `latest.json` (release asset) to diff against.
//   3. Reads the previous manifest from the checked-out feed repo.
//   4. planPublish() → snapshot + delta + manifest, pruning the delta chain.
//   5. Writes latest.json (for release upload) + commits manifest/delta into
//      the feed repo working tree, deleting pruned delta files.
//
// The workflow does the `gh release upload` + `git commit/push`.
//
// Env:
//   FEED_REPO      owner/name of the feed repo      (default jmaleonard/tripwire-feed)
//   FEED_DIR       path to the checked-out feed repo (default ./feed-repo)
//   FEED_TAG       release tag for full snapshots    (default feed)
//   OUT_DIR        where to write latest.json         (default ./feed-out)
//   KEEP_DELTAS    delta retention                    (default 30)
//   PUBLISH_DATE   override YYYY-MM-DD (testing)       (default UTC today)

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AikidoFeed, runSeeder, parseManifest, parseSnapshot, planPublish } from '../packages/feeds/dist/index.js';

const FEED_REPO = process.env.FEED_REPO ?? 'jmaleonard/tripwire-feed';
const FEED_DIR = process.env.FEED_DIR ?? join(process.cwd(), 'feed-repo');
const FEED_TAG = process.env.FEED_TAG ?? 'feed';
const OUT_DIR = process.env.OUT_DIR ?? join(process.cwd(), 'feed-out');
const KEEP_DELTAS = Number(process.env.KEEP_DELTAS ?? '30');
// `||` not `??`: a workflow_dispatch / schedule with no date input passes an
// empty string, which must still fall back to today.
const DATE = process.env.PUBLISH_DATE || new Date().toISOString().slice(0, 10);

const FEED_V1 = join(FEED_DIR, 'feed', 'v1');
const MANIFEST_PATH = join(FEED_V1, 'manifest.json');
const FULL_URL = `https://github.com/${FEED_REPO}/releases/download/${FEED_TAG}/latest.json`;
const deltaUrl = date =>
  `https://raw.githubusercontent.com/${FEED_REPO}/main/feed/v1/delta-${date}.json`;

async function fetchJson(url) {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

function readJsonFile(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

async function main() {
  console.log(`[publish-feed] date=${DATE} repo=${FEED_REPO}`);

  // 1. Seed today's IoC set.
  const seed = await runSeeder([new AikidoFeed()]);
  const okSources = seed.sourceStats.filter(s => s.ok);
  if (okSources.length === 0) {
    throw new Error(`all feed sources failed: ${JSON.stringify(seed.sourceStats)}`);
  }
  console.log(`[publish-feed] seeded ${seed.entries.length} IoCs`);

  // 2. Previous snapshot (for the diff) + 3. previous manifest.
  const prevManifestJson = readJsonFile(MANIFEST_PATH);
  const prevManifest = prevManifestJson ? parseManifest(prevManifestJson) : null;

  let prevEntries = [];
  if (prevManifest) {
    const prevSnapshotJson = await fetchJson(FULL_URL);
    if (prevSnapshotJson) {
      prevEntries = parseSnapshot(prevSnapshotJson).entries;
      console.log(`[publish-feed] previous snapshot: ${prevEntries.length} IoCs`);
    } else {
      console.log('[publish-feed] no previous latest.json found; treating as baseline');
    }
  }

  // 4. Plan.
  const plan = planPublish({
    nextEntries: seed.entries,
    date: DATE,
    generatedAt: seed.generatedAt,
    prevEntries,
    prevManifest,
    fullUrl: FULL_URL,
    deltaUrl,
    keepDeltas: KEEP_DELTAS,
  });

  // 5. Write outputs.
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(FEED_V1, { recursive: true });

  writeFileSync(join(OUT_DIR, 'latest.json'), plan.snapshotBody);
  writeFileSync(MANIFEST_PATH, plan.manifestBody);

  if (plan.deltaBody) {
    writeFileSync(join(FEED_V1, `delta-${DATE}.json`), plan.deltaBody);
    console.log(
      `[publish-feed] delta-${DATE}: +${plan.delta.added.length} −${plan.delta.removed.length}`,
    );
  } else {
    console.log('[publish-feed] no delta (baseline run)');
  }

  for (const date of plan.prunedDeltaDates) {
    const stale = join(FEED_V1, `delta-${date}.json`);
    rmSync(stale, { force: true });
    console.log(`[publish-feed] pruned delta-${date}.json`);
  }

  console.log(
    `[publish-feed] manifest: full=${plan.manifest.full.count} IoCs, ` +
      `${plan.manifest.deltas.length} deltas, latest=${plan.manifest.latest_date}`,
  );
  console.log(`[publish-feed] wrote ${join(OUT_DIR, 'latest.json')} (for release upload)`);
}

main().catch(err => {
  console.error('[publish-feed] failed:', err);
  process.exit(1);
});
