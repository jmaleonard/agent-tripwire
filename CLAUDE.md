# CLAUDE.md — agent-tripwire

Project context for Claude Code. (Repo dir name: `tripwire`; package name: `agent-tripwire`.)

## What this is

A local-first runtime detection daemon for dev laptops. Watches sensitive paths
(`~/.ssh`, `~/.aws`, agent tokens, …), walks the process tree to attribute who
touched them, and notifies in past tense. Detection only, no blocking. Every
event is enriched against a daily feed of ~130K known-malicious npm/PyPI
packages. See `README.md` for the pitch, `spec/` for the full spec.

## Monorepo (pnpm workspaces, Node 22, TypeScript ESM)

`packages/`: `shared` (types) · `store` (SQLite) · `feeds` (IoC sources + feed
delta/manifest/publish logic) · `watcher` (native Rust helper + mock) ·
`identity` (process-tree) · `engine` (rules + IoC enrichment) · `notifier` ·
`dashboard` (Hono on :7878) · `daemon` (ties it together) · `cli` (`tripwire …`) ·
`lambda-seeder` (legacy AWS, being retired).
`apps/menubar-macos` (Swift). `helpers/tripwire-watcher` (Rust).

## Dev commands — USE pnpm, NOT npm

```bash
pnpm install        # NOT `npm install` — npm leaves a stray package-lock.json
pnpm build          # tsc across packages; required before typecheck
pnpm typecheck      # needs a prior `pnpm build` (project refs / .d.ts outputs)
pnpm test           # vitest; ~336 tests
```

If tests fail with "Failed to load url better-sqlite3/yaml/@aws-sdk", someone ran
`npm install` — delete `package-lock.json` and run `pnpm install`.

## Current work — branch `feat/github-feed-sync`

Closed the gap where the daemon ran with an **empty IoC table** (nothing pulled
the feed). Now there's a full round-trip:

- **Client sync** — `packages/daemon/src/ioc-sync.ts` `IoCSyncService`: conditional
  GET (ETag) → `planSync` (full vs delta) → SHA-256-verify → apply
  (`replaceAll`/`upsert`/`remove`). Runs on daemon startup + every 6h; coalesces
  concurrent runs. `tripwire ioc sync` / `POST /api/iocs/sync` force it.
  `feed_state` table (store migration 002) is the bookmark.
- **Delta feed** — `packages/feeds/src/{delta,manifest,publish}.ts`: `computeDelta`,
  `planPublish`, `planSync`. Daily deltas chain among themselves; `full` (=
  latest snapshot) is the fallback for empty/far-behind clients.
- **Publishing** — moved OFF AWS. The public repo **`jmaleonard/tripwire-feed`**
  self-publishes via its own GitHub Action (built-in `GITHUB_TOKEN`, no PAT).
  Full snapshot → release asset `snapshot-<date>.json` (date-stamped so the
  Fastly CDN URL is never stale); deltas + manifest committed. Source of truth
  for the publisher is `scripts/publish-feed.mjs` here; the feed repo runs an
  esbuild **bundle** of it — regenerate after edits:
  ```bash
  pnpm --filter @tripwire/shared --filter @tripwire/feeds build
  npx esbuild scripts/publish-feed.mjs --bundle --platform=node --format=esm \
    --outfile=<tripwire-feed checkout>/scripts/publish-feed.mjs
  ```
  Then commit/push the bundle in the feed repo. Trigger a run:
  `gh workflow run seed-feed.yml --repo jmaleonard/tripwire-feed`.

Feed is **live and verified**: a real daemon syncs ~132K IoCs from it.
Format/details: `spec/docs/feed.md`.

## Gotchas

- **`origin` is `s3://agent-trip-wire-git/tripwire`**, NOT GitHub. The public
  `github.com/jmaleonard/agent-tripwire` is a separate remote/mirror. Push with
  `git push origin <branch>` (S3).
- The **feed repo's workflow lives in `tripwire-feed`**, not here (so it can use
  `GITHUB_TOKEN`). This repo only holds the publisher source.
- `gh` is authed as `jmaleonard` (scopes: repo, workflow; **no** `delete_repo`).

## Open items (not yet done)

- Decommission the legacy AWS seeder (now that the GitHub feed is live):
  `aws cloudformation delete-stack --stack-name agent-tripwire-seeder --region us-east-1`
  (bucket is `DeletionPolicy: Retain`; remove separately). Account `190236274723`.
- Linux `fanotify` watcher helper (macOS uses the `notify` crate today).
- `feat/github-feed-sync` not yet merged to `main` / no PR.
