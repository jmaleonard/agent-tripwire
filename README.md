<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img alt="tripwire" src="assets/logo-light.svg" width="360">
  </picture>
</p>

<p align="center">
  <b>Know the moment something on your machine reads your secrets — and who did it.</b>
</p>

<p align="center">
  <img alt="platform: macOS | Linux" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-444">
  <img alt="status: alpha" src="https://img.shields.io/badge/status-alpha-e5484d">
  <img alt="local-first" src="https://img.shields.io/badge/local--first-no%20telemetry-2da44e">
</p>

---

Tripwire is a background daemon for developer laptops. It watches your sensitive
files (`~/.ssh`, `~/.aws`, `~/.config` agent tokens, browser cookies, …) and the
instant one is touched, it walks the process tree to figure out *what* touched
it and tells you — after the fact, in plain language:

```
⚠️  HIGH — ~/.aws/credentials was read
    by  node  →  npm:some-build-tool@2.3.1   (flagged malicious)
    2s ago · via an npm postinstall, no human in the parent chain
```

A malicious npm/PyPI package or a coding agent gone rogue reads your credentials
silently. Tripwire makes it **loud**.

## Why you need it

The npm and PyPI ecosystems are under sustained, AI-agent-targeted attack — and
the attacks don't stop at install time:

- **Shai-Hulud** — a self-propagating worm that steals credentials and uses them
  to publish itself from your packages. ([writeup](https://thehackernews.com/2026/04/self-propagating-supply-chain-worm.html))
- **Mini Shai-Hulud** — compromised SAP/`@cap-js` npm packages that weaponized
  `.claude/settings.json` and `.vscode/tasks.json` as persistence. ([writeup](https://thehackernews.com/2026/04/sap-npm-packages-compromised-by-mini.html))
- **node-ipc** — a popular dependency shipped with a credential-stealing payload.
  ([writeup](https://www.stepsecurity.io/blog/node-ipc-npm-supply-chain-attack))
- Asurion, Namastex Labs, and Bitwarden-CLI impersonations — at roughly a weekly
  cadence.

Install-time blockers like [Aikido Safe Chain](https://aikido.dev/safe-chain) and
[Socket Firewall](https://socket.dev/firewall) stop known-bad packages from
*entering* your project. They're necessary — but they can't see what an installed
package does three hours later, on a hot path, inside an agent subprocess: read
your SSH key, drop a persistence file, exfiltrate a token.

**Tripwire is the runtime layer for that gap.** Run it *alongside* an install-time
blocker, not instead of one.

## What it does

- **Runtime file watcher.** A native helper (`fanotify` on Linux, `fsevents` on
  macOS) watches a curated set of high-value paths.
- **Agent-aware attribution.** When something fires, it walks the process tree to
  PID 1, captures argv + environment, and classifies the ancestry — interactive
  shell, Claude Code subprocess, npm postinstall, editor. That classification is
  what takes alert volume from 30/day to ~1/week.
- **Past-tense notifications.** Native OS notifications that tell you what
  happened (the read already completed) — never "blocking…". Snooze with a hard
  24-hour ceiling.
- **Malware-feed enrichment.** Every event is checked against a daily feed of
  ~130K known-malicious npm + PyPI packages, so "who read this" comes with "and
  it's on the malware list."
- **`tripwire tui`** — a terminal inspector for the whole timeline, plus a macOS
  menu-bar app for at-a-glance status.

It's **detection, not blocking** — it catches what slips past install-time tools.
**Local-first:** the only network call is pulling the public malware list.

## Get started (macOS)

```bash
brew install --HEAD jmaleonard/tap/tripwire
tripwire setup                  # creates ~/.tripwire, applies a quiet period
brew services start tripwire    # run on login
tripwire tui                    # watch events live
```

```
┌ tripwire ───────────────────────────── ● daemon up · feed 132k IoCs ┐
│ 24h: ⛔1 crit  ⚠3 high  ●5 med  2 low          🔕 snoozed: all (1h02m)│
├──────────────────────────────────────────────────────────────────────┤
│ ❯ 14:22:01 CRIT  cred.aws-credentials-read  node←claude-code (agent) ⚑ │
│   14:19:44 HIGH  cred.ssh-private-key-read   bash←npm (pkg-spawned)     │
│   14:03:12 MED   cred.npmrc-read             node (unknown)             │
├──────────────────────────────────────────────────────────────────────┤
│ ↑/↓ move · ⏎ detail · a allowlist · s snooze · x dismiss · q quit      │
└──────────────────────────────────────────────────────────────────────┘
```

Prefer not to install yet? [`spec/INSTALL.md`](./spec/INSTALL.md) covers Linux,
from-source, and troubleshooting.

## What it catches

| Event | Detection | Typical category |
|-------|-----------|------------------|
| `node` subprocess of `claude-code` reads `~/.aws/credentials` | `cred.aws-credentials-read` + IoC enrichment | `agent-subprocess` |
| `bash` spawned by `npm install` reads `~/.ssh/id_rsa` | `cred.ssh-private-key-read` | `package-manager-spawned` |
| A postinstall writes `.claude/settings.json` | `persist.claude-settings-write` | `package-manager-spawned` |
| Editor writes `.vscode/tasks.json` to a project | (allowlisted by default) | `human-shell` |
| Unknown process drops `~/Library/LaunchAgents/*.plist` | `persist.launchd-plist-drop` | `unknown` |
| A package on the malware feed reads any credential | severity bumped to critical | any |

Rules are YAML and yours to edit — see the [rule guide](./spec/docs/rules.md).

## How it works

```
fs watcher → identify (walk process tree) → rules engine (+ malware feed) → notify + SQLite
                                                                                  ↑
                                            tripwire tui · CLI · menu-bar app read it directly
```

A native Rust helper delivers kernel filesystem events; the daemon correlates
them to a PID, classifies the ancestry, runs your rules, enriches with the
malware feed, and writes everything to a local SQLite store that the CLI, the
`tripwire tui` inspector, and the macOS menu-bar app read directly.

## Use it

```bash
tripwire status                 # recent events + counts + daemon/snooze state
tripwire tui                    # interactive event inspector
tripwire snooze add 1h          # going to do noisy stuff — hush for an hour
tripwire allowlist add <rule> --process /usr/bin/aws   # bless a known-good actor
tripwire ioc <package>          # is this package on the malware list?
```

## Status

Alpha. The daemon, CLI, `tripwire tui`, macOS menu-bar app, and the malware feed
all work; macOS is the primary platform and the Linux `fanotify` watcher has
landed. The feed is published daily and free to host — see
[`spec/docs/feed.md`](./spec/docs/feed.md).

## More

- [`spec/agent-tripwire-spec.md`](./spec/agent-tripwire-spec.md) — full technical spec
- [`spec/INSTALL.md`](./spec/INSTALL.md) · [`spec/docs/rules.md`](./spec/docs/rules.md) · [`spec/docs/feed.md`](./spec/docs/feed.md)
- [`spec/CONTRIBUTING.md`](./spec/CONTRIBUTING.md) · [`spec/SECURITY.md`](./spec/SECURITY.md)

## License

TBD (Apache-2.0 or MIT planned).
