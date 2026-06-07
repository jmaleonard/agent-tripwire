# IoC feed distribution

How the IoC list gets from upstream (Aikido) to the local SQLite DB that the
engine queries on every event.

## Why GitHub, not S3

The feed is a static, public, daily-refreshed dataset. Hosting it on S3 means
paying for egress every time a client pulls (and clients can't read a
private bucket without AWS creds). GitHub serves both halves for free:

- **Full snapshot** (~28 MB) → a **release asset** on a rolling `feed` tag,
  named `snapshot-<date>.json`. Release assets are CDN-backed, have no
  bandwidth billing, and don't count against the repo's git history size. The
  name is date-stamped (never reused) so the CDN URL is always fresh —
  clobbering a single `latest.json` lets Fastly serve a stale copy.
- **Deltas + manifest** (KB each) → **committed to the repo** under
  `feed/v1/`. Small, so the repo grows slowly, and the commit log doubles as
  an audit trail of what changed each day.

Repo: **`jmaleonard/tripwire-feed`** (public).

## Layout

```
Release `feed` tag:
  snapshot-YYYY-MM-DD.json         full snapshot, 3 newest retained ← manifest points here
  latest.json                      clobbered mirror of newest       ← human convenience only

Repo feed/v1/:
  manifest.json                    index the client reads first
  delta-YYYY-MM-DD.json            one per day, last 30 retained
```

### manifest.json

```jsonc
{
  "feed_version": 1,
  "generated_at": "2026-05-30T06:00:00.000Z",
  "latest_date": "2026-05-30",
  "full":   { "date": "...", "url": "...snapshot-2026-05-30.json", "sha256": "...", "count": 0, "bytes": 0 },
  "deltas": [ { "date": "...", "base_date": "...", "url": "...delta-….json", "sha256": "...", "added": 0, "removed": 0 } ]
}
```

The `deltas` form a chain (each `base_date` is the previous entry's `date`).
`full` is the fallback baseline for a client that's never synced or has fallen
off the retained chain.

## Producer — the feed repo's own workflow

The daily job lives **in the `tripwire-feed` repo** (`.github/workflows/seed-feed.yml`)
and publishes to itself using the built-in `GITHUB_TOKEN` — **no PAT or secrets
to configure.** It runs a self-contained bundle of `scripts/publish-feed.mjs`
(esbuild, ~12 KB, no `npm install`), so the feed repo doesn't need this source
tree at runtime. Daily at 06:00 UTC (or **Run workflow**):

1. Run the seeder (Aikido npm + PyPI) → today's set.
2. Read the previous `manifest.json` from the repo and download the snapshot it
   points at (`full.url`) to diff against.
3. `planPublish()` (`packages/feeds/src/publish.ts`) → snapshot + delta +
   manifest, pruning the delta chain to 30 days.
4. Upload `snapshot-<date>.json` (+ a `latest.json` mirror) as release assets,
   prune to the 3 newest snapshots, and commit `manifest.json` +
   `delta-<date>.json`.

`scripts/publish-feed.mjs` here is the **source of truth**; regenerate the
feed repo's bundle after changing it:

```bash
pnpm --filter @tripwire/shared --filter @tripwire/feeds build
npx esbuild scripts/publish-feed.mjs --bundle --platform=node --format=esm \
  --outfile=<tripwire-feed>/scripts/publish-feed.mjs
```

## Consumer — `IoCSyncService`

`packages/daemon/src/ioc-sync.ts`. The daemon syncs on startup and every 6h
(and on demand via `tripwire ioc sync`):

1. Conditional `GET manifest.json` (ETag); `304` → nothing to do.
2. `planSync(manifest, syncedDate)` → `up_to_date` | `delta` | `full`.
3. Download what's needed, **verify each body's SHA-256** against the manifest,
   apply: `replaceAll()` for a full snapshot, `upsert()` + `remove()` for each
   delta. Persist the new `synced_date` + ETag in `feed_state`.

Overrides: `TRIPWIRE_FEED_URL` (manifest URL), `TRIPWIRE_NO_FEED_SYNC=1`
(disable).

## Public report — top offenders (GitHub Pages)

A public page ranks the feed's "top offenders" (most recently flagged, biggest
campaigns, highest-confidence/multi-source). A GitHub Action generates a static
page and deploys it to GitHub Pages, the same way the feed itself publishes.

- Ranking + HTML live in `@tripwire/feeds` (`computeTopOffenders` /
  `renderTopOffendersHtml`, unit-tested). `scripts/build-site.mjs` is the IO:
  fetch the manifest → verify the snapshot SHA-256 → write
  `site/{index.html,top-offenders.json}`.
- The `tripwire-feed` workflow runs a bundled `build-site.mjs` after publishing
  and deploys `site/` to Pages → `https://jmaleonard.github.io/tripwire-feed/`.
- `scripts/build-site.mjs` here is the **source of truth**; regenerate the bundle
  after changes:
  ```bash
  pnpm --filter @tripwire/shared --filter @tripwire/feeds build
  npx esbuild scripts/build-site.mjs --bundle --platform=node --format=esm \
    --outfile=<tripwire-feed>/scripts/build-site.mjs
  ```
- Campaigns + multi-source sections populate only when the feed carries that
  data; with the Aikido-only feed today, "most recently flagged" is the live
  section.

## Migrating off AWS

The old Lambda + S3 seeder (`infrastructure/`) is superseded by the workflow
above. To decommission once the GitHub feed is verified live:

```bash
aws cloudformation delete-stack --stack-name agent-tripwire-seeder --region us-east-1
# bucket is DeletionPolicy:Retain — remove separately if desired
```
