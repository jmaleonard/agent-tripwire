# agent-tripwire

A runtime detection daemon for developer workstations. Watches your sensitive paths (`~/.ssh`, `~/.aws`, agent configs, browser cookies, etc.), walks the process tree to figure out who touched them, and tells you in past tense. Local-first. No cloud. Detection only — not a blocker. Designed to run **alongside** install-time blockers like Aikido Safe Chain.

## Status

**Phase 0 deployed.** The IoC seeder is live: a daily 06:00 UTC Lambda fetches Aikido's npm + PyPI malware lists, merges them, and publishes `latest.json` (~28 MB, ~130K IoCs) to S3. See [`infrastructure/`](./infrastructure/) for the CloudFormation template and deploy script.

Library packages landed: `@tripwire/shared` (types + ancestry precedence + severity), `@tripwire/store` (SQLite + 4 tables from spec §6.11), `@tripwire/feeds` (Aikido fetcher + `FeedSource` interface + merger + orchestrator), `@tripwire/lambda-seeder` (handler + bundling), `@tripwire/watcher` (`FsEvent` + `FsWatcher` interface + `MockFsWatcher`; real fanotify/fsevents helpers in a follow-up PR), `@tripwire/identity` (process tree walker + ancestry classifier + Linux `/proc` reader + macOS `ps` reader). Live-tested on macOS — correctly classified our own Node process as `agent-subprocess` of Claude Code via process-tree walking.

Next: `@tripwire/engine` (rule evaluation + allowlist + snooze + IoC enrichment) per [`spec/agent-tripwire-spec.md §12`](./spec/agent-tripwire-spec.md).

The full specification lives in [`spec/`](./spec/):

- [`spec/README.md`](./spec/README.md) — project pitch and quick start
- [`spec/agent-tripwire-spec.md`](./spec/agent-tripwire-spec.md) — technical specification
- [`spec/INSTALL.md`](./spec/INSTALL.md) — installation guide
- [`spec/docs/rules.md`](./spec/docs/rules.md) — rule authoring guide
- [`spec/docs/community-feed.md`](./spec/docs/community-feed.md) — community IoC feed design
- [`spec/CONTRIBUTING.md`](./spec/CONTRIBUTING.md)
- [`spec/SECURITY.md`](./spec/SECURITY.md)

Build order is in `spec/agent-tripwire-spec.md §12`.
