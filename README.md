# agent-tripwire

A runtime detection daemon for developer workstations. Watches your sensitive paths (`~/.ssh`, `~/.aws`, agent configs, browser cookies, etc.), walks the process tree to figure out who touched them, and tells you in past tense. Local-first. No cloud. Detection only — not a blocker. Designed to run **alongside** install-time blockers like Aikido Safe Chain.

## Status

**Phase 0 deployed.** The IoC seeder is live: a daily 06:00 UTC Lambda fetches Aikido's npm + PyPI malware lists, merges them, and publishes `latest.json` (~28 MB, ~130K IoCs) to S3. See [`infrastructure/`](./infrastructure/) for the CloudFormation template and deploy script.

Library packages: `@tripwire/shared`, `@tripwire/store`, `@tripwire/feeds`, `@tripwire/lambda-seeder` (deployed), `@tripwire/watcher` (interface + mock), `@tripwire/identity` (Linux + macOS readers + classifier), `@tripwire/engine` (rule loader + path predicates + allowlist + snooze + IoC enrichment), `@tripwire/notifier` (past-tense formatter + macOS terminal-notifier/osascript + Linux notify-send + platform factory), `@tripwire/dashboard` (Hono HTTP server on `localhost:7878`).

A native macOS menu-bar app ships in [`apps/menubar-macos/`](./apps/menubar-macos/) — Swift, ~200 LOC, < 1 MB `.app` bundle. Polls the dashboard server and shows severity-aware SF Symbols, last-24h counts, active snooze status with one-click clear, and the last 5 events click-through to the dashboard.

**The full daemon is alive.** `@tripwire/daemon` ties everything into a single long-running process: watcher → identify → engine → store → notifier + dashboard server. `node scripts/daemon-demo.mjs` spins it up with a synthetic event and you'll see (a) a real macOS notification banner, (b) `localhost:7878/api/summary` reflecting the event, and (c) the menubar icon flipping within one poll cycle.

Next: snooze CLI surface, the `tripwire` user CLI (setup / doctor / status), and the deferred Rust fanotify helper that replaces `MockFsWatcher` with real kernel events.

The full specification lives in [`spec/`](./spec/):

- [`spec/README.md`](./spec/README.md) — project pitch and quick start
- [`spec/agent-tripwire-spec.md`](./spec/agent-tripwire-spec.md) — technical specification
- [`spec/INSTALL.md`](./spec/INSTALL.md) — installation guide
- [`spec/docs/rules.md`](./spec/docs/rules.md) — rule authoring guide
- [`spec/docs/community-feed.md`](./spec/docs/community-feed.md) — community IoC feed design
- [`spec/CONTRIBUTING.md`](./spec/CONTRIBUTING.md)
- [`spec/SECURITY.md`](./spec/SECURITY.md)

Build order is in `spec/agent-tripwire-spec.md §12`.
