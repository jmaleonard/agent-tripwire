# agent-tripwire

A runtime detection daemon for developer workstations. Watches your sensitive paths (`~/.ssh`, `~/.aws`, agent configs, browser cookies, etc.), walks the process tree to figure out who touched them, and tells you in past tense. Local-first. No cloud. Detection only — not a blocker. Designed to run **alongside** install-time blockers like Aikido Safe Chain.

## Status

**Phase 0 deployed.** The IoC seeder is live: a daily 06:00 UTC Lambda fetches Aikido's npm + PyPI malware lists, merges them, and publishes `latest.json` (~28 MB, ~130K IoCs) to S3. See [`infrastructure/`](./infrastructure/) for the CloudFormation template and deploy script.

Library packages landed: `@tripwire/shared`, `@tripwire/store`, `@tripwire/feeds`, `@tripwire/lambda-seeder` (deployed), `@tripwire/watcher` (interface + mock), `@tripwire/identity` (Linux + macOS readers + classifier), `@tripwire/engine` (rule loader + path predicates + allowlist + snooze + IoC enrichment), `@tripwire/notifier` (past-tense formatter + macOS terminal-notifier/osascript + Linux notify-send + platform factory).

The full pipeline runs end-to-end on real macOS process trees: identity walker → engine → notifier → real macOS notification banner. A synthetic credential-read from a Claude-Code-subprocess ancestry produces a correctly classified, attributed, severity-tagged event surfaced via Notification Center.

Next: snooze CLI, daemon glue (long-running process wiring watcher → identify → engine → store → notifier), dashboard.

The full specification lives in [`spec/`](./spec/):

- [`spec/README.md`](./spec/README.md) — project pitch and quick start
- [`spec/agent-tripwire-spec.md`](./spec/agent-tripwire-spec.md) — technical specification
- [`spec/INSTALL.md`](./spec/INSTALL.md) — installation guide
- [`spec/docs/rules.md`](./spec/docs/rules.md) — rule authoring guide
- [`spec/docs/community-feed.md`](./spec/docs/community-feed.md) — community IoC feed design
- [`spec/CONTRIBUTING.md`](./spec/CONTRIBUTING.md)
- [`spec/SECURITY.md`](./spec/SECURITY.md)

Build order is in `spec/agent-tripwire-spec.md §12`.
