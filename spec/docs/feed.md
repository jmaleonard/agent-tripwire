# IoC feed distribution

How the IoC list gets from upstream (Aikido) to the local SQLite DB that the
engine queries on every event.

## Why GitHub, not S3

The feed is a static, public, daily-refreshed dataset. Hosting it on S3 means
paying for egress every time a client pulls (and clients can't read a
private bucket without AWS creds). GitHub serves both halves for free:

- **Full snapshot** (~28 MB) → a **release asset** on a rolling `feed` tag.
  Release assets are CDN-backed, have no bandwidth billing, and don't count
  against the repo's git history size.
- **Deltas + manifest** (KB each) → **committed to the repo** under
  `feed/v1/`. Small, so the repo grows slowly, and the commit log doubles as
  an audit trail of what changed each day.

Repo: **`jmaleonard/tripwire-feed`** (public).

## Layout

```
Release `feed` tag:
  latest.json                      full snapshot (today)  ← release asset

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
  "full":   { "date": "...", "url": "...latest.json", "sha256": "...", "count": 0, "bytes": 0 },
  "deltas": [ { "date": "...", "base_date": "...", "url": "...delta-….json", "sha256": "...", "added": 0, "removed": 0 } ]
}
```

The `deltas` form a chain (each `base_date` is the previous entry's `date`).
`full` is the fallback baseline for a client that's never synced or has fallen
off the retained chain.

## Producer — `.github/workflows/seed-feed.yml`

Runs daily at 06:00 UTC (this repo has the source):

1. Build `@tripwire/feeds`, run the seeder (Aikido npm + PyPI) → today's set.
2. Download the previous `latest.json` (release asset) to diff against; read
   the previous `manifest.json` from the checked-out feed repo.
3. `planPublish()` (`packages/feeds/src/publish.ts`) → snapshot + delta +
   manifest, pruning the delta chain to 30 days.
4. Upload `latest.json` as the release asset (`--clobber`); commit
   `manifest.json` + `delta-<date>.json` to the feed repo.

**Setup required:** a repo secret `FEED_REPO_TOKEN` — a PAT (or fine-grained
token) with `contents:write` on `jmaleonard/tripwire-feed`. The feed repo must
exist and be public.

## Consumer — `IoCSyncService`

`packages/daemon/src/ioc-sync.ts`. The daemon syncs on startup and every 6h
(and on demand via `tripwire ioc sync` → `POST /api/iocs/sync`):

1. Conditional `GET manifest.json` (ETag); `304` → nothing to do.
2. `planSync(manifest, syncedDate)` → `up_to_date` | `delta` | `full`.
3. Download what's needed, **verify each body's SHA-256** against the manifest,
   apply: `replaceAll()` for a full snapshot, `upsert()` + `remove()` for each
   delta. Persist the new `synced_date` + ETag in `feed_state`.

Overrides: `TRIPWIRE_FEED_URL` (manifest URL), `TRIPWIRE_NO_FEED_SYNC=1`
(disable).

## Migrating off AWS

The old Lambda + S3 seeder (`infrastructure/`) is superseded by the workflow
above. To decommission once the GitHub feed is verified live:

```bash
aws cloudformation delete-stack --stack-name agent-tripwire-seeder --region us-east-1
# bucket is DeletionPolicy:Retain — remove separately if desired
```
