# agent-tripwire

A runtime detection daemon for developer workstations. Watches your sensitive paths (`~/.ssh`, `~/.aws`, agent configs, browser cookies, etc.), walks the process tree to figure out who touched them, and tells you in past tense. Local-first. No cloud. Detection only — not a blocker. Designed to run **alongside** install-time blockers like Aikido Safe Chain.

## Install (macOS, via Homebrew)

```bash
brew install --HEAD jmaleonard/tap/tripwire   # or: brew install --HEAD --formula ./Formula/tripwire.rb
tripwire setup
brew services start tripwire                  # autostart on login
tripwire status
```

The formula builds the Node daemon + CLI, builds the Swift menubar `.app`, registers the daemon with launchd via `brew services`, and places the menubar app under the brew prefix. Drag it into `~/Applications/` if you want it as a login item.

## Status

**Phase 0 deployed.** A daily 06:00 UTC job fetches Aikido's npm + PyPI malware lists, merges them (~130K IoCs), and publishes them for clients to pull.

The IoC feed is moving from S3 to a free GitHub-hosted distribution: a GitHub Actions workflow ([`.github/workflows/seed-feed.yml`](./.github/workflows/seed-feed.yml)) publishes the full snapshot as a release asset on `jmaleonard/tripwire-feed` and commits daily deltas + a manifest. The daemon pulls it into local SQLite on startup and every 6h (`tripwire ioc sync` to force it), downloading only the deltas it's missing and SHA-256-verifying every body. See [`spec/docs/feed.md`](./spec/docs/feed.md). The original AWS Lambda + S3 seeder in [`infrastructure/`](./infrastructure/) is superseded by the workflow.

Library packages: `@tripwire/shared`, `@tripwire/store`, `@tripwire/feeds`, `@tripwire/lambda-seeder` (deployed), `@tripwire/watcher` (interface + mock), `@tripwire/identity` (Linux + macOS readers + classifier), `@tripwire/engine` (rule loader + path predicates + allowlist + snooze + IoC enrichment), `@tripwire/notifier` (past-tense formatter + macOS terminal-notifier/osascript + Linux notify-send + platform factory), `@tripwire/dashboard` (Hono HTTP server on `localhost:7878`).

A native macOS menu-bar app ships in [`apps/menubar-macos/`](./apps/menubar-macos/) — Swift, ~200 LOC, < 1 MB `.app` bundle. Polls the dashboard server and shows severity-aware SF Symbols, last-24h counts, active snooze status with one-click clear, and the last 5 events click-through to the dashboard.

**The full daemon is alive.** `@tripwire/daemon` ties everything into a single long-running process: watcher → identify → engine → store → notifier + dashboard server.

The user-facing CLI ships in `@tripwire/cli` — `tripwire setup` / `daemon run` / `daemon status` / `status` / `snooze {list,add,clear}` / `allowlist {list,add,remove}` / `ioc <package>` / `dashboard` / `doctor` / `uninstall`. `Formula/tripwire.rb` distributes the whole thing via Homebrew.

Next: the deferred Rust fanotify helper that replaces `MockFsWatcher` with real kernel events on Linux; macOS native fsevents binding for write events.

The full specification lives in [`spec/`](./spec/):

- [`spec/README.md`](./spec/README.md) — project pitch and quick start
- [`spec/agent-tripwire-spec.md`](./spec/agent-tripwire-spec.md) — technical specification
- [`spec/INSTALL.md`](./spec/INSTALL.md) — installation guide
- [`spec/docs/rules.md`](./spec/docs/rules.md) — rule authoring guide
- [`spec/docs/community-feed.md`](./spec/docs/community-feed.md) — community IoC feed design
- [`spec/CONTRIBUTING.md`](./spec/CONTRIBUTING.md)
- [`spec/SECURITY.md`](./spec/SECURITY.md)

Build order is in `spec/agent-tripwire-spec.md §12`.
