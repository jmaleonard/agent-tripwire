# tripwire

**Tells you when something on your machine reads your secrets — and who did it.**

Tripwire is a background daemon for developer laptops. It watches your sensitive
files (`~/.ssh`, `~/.aws`, `~/.config` agent tokens, browser cookies, …) and the
moment one is touched, it walks the process tree to figure out *what* touched it
and tells you — after the fact, in plain language:

```
⚠️  HIGH — ~/.aws/credentials was read
    by  node  →  npm:some-build-tool@2.3.1   (flagged malicious)
    2s ago · via npm postinstall, no human in the parent chain
```

That's the whole point: a malicious npm/PyPI package or a coding agent gone
rogue reads your credentials silently. Tripwire makes it *loud*.

- **Detection, not blocking.** It won't stop the read — it catches what slips
  past install-time blockers like Aikido Safe Chain. Run it alongside them.
- **Local-first. No cloud.** Everything stays on your machine. The only network
  call is pulling the public malware-package list.
- **Knows malicious packages.** Every event is enriched against a daily feed of
  ~130K known-bad npm + PyPI packages, so "who read this" comes with "and it's
  on the malware list."

## Install (macOS)

```bash
brew install --HEAD jmaleonard/tap/tripwire
tripwire setup                  # creates ~/.tripwire, applies a quiet period
brew services start tripwire    # run on login
tripwire status                 # check it's alive
```

## Use it

```bash
tripwire status                 # recent events + counts + snooze state
tripwire snooze add 1h          # going to do noisy stuff — hush for an hour
tripwire allowlist add <rule> --process /usr/bin/aws   # bless a known-good actor
tripwire ioc <package>          # is this package on the malware list?
tripwire dashboard              # open the web UI on localhost:7878
```

A native macOS **menu-bar app** ships too: severity-aware icon, last-24h count,
one-click snooze, and the last 5 events.

## How it works

```
fs watcher → identify (walk process tree) → rules engine (+ malware feed) → notify + dashboard + SQLite
```

A native Rust helper delivers kernel filesystem events; the daemon correlates
them to a PID, runs them through your rules, enriches with the malware feed, and
surfaces anything that matters. Rules are YAML and yours to edit
([rule guide](./spec/docs/rules.md)).

## Status

Daemon, CLI, menu-bar app, and the malware feed are all working. The feed is
published daily and free to host — see [`spec/docs/feed.md`](./spec/docs/feed.md).
macOS is the supported platform today; Linux (fanotify) is in progress.

## More

- [`spec/agent-tripwire-spec.md`](./spec/agent-tripwire-spec.md) — full technical spec
- [`spec/INSTALL.md`](./spec/INSTALL.md) · [`spec/docs/rules.md`](./spec/docs/rules.md) · [`spec/docs/feed.md`](./spec/docs/feed.md)
- [`spec/CONTRIBUTING.md`](./spec/CONTRIBUTING.md) · [`spec/SECURITY.md`](./spec/SECURITY.md)
