# agent-tripwire

**A runtime detection daemon that tells you when something on your dev machine just touched a credential file or an agent config.**

Watches your sensitive paths. Walks the process tree to figure out who did it. Pings you with a notification. Logs everything to a local SQLite store you inspect from a terminal UI. Local-first. Open rules. No cloud required.

This is the **runtime layer** that install-time supply-chain blockers like [Aikido Safe Chain](https://aikido.dev/safe-chain) and [Socket Firewall](https://socket.dev/firewall) don't cover. Run tripwire alongside them, not instead.

---

## Why

The npm and PyPI ecosystems are under sustained attack:

- **May 2026** — `node-ipc` compromised with a credential-stealing payload.
- **April 2026** — Mini Shai-Hulud weaponized `.claude/settings.json` and `.vscode/tasks.json` as persistence vectors.
- **April 2026** — Asurion impersonation, Namastex Labs self-spreading, Bitwarden CLI impersonation. Roughly weekly cadence.

Install-time tools catch packages at the moment they're added to your project. That's necessary, but not sufficient:

- They miss anything `node_modules` does at **runtime** — three hours later, on a hot path, inside an agent subprocess.
- They miss persistence: a settings file dropped at runtime that re-executes the next time you open the IDE.
- They miss agent-routed compromise: an MCP server or proxy that injects a `curl | bash` mid-stream.

Tripwire is built for that gap. It watches the things attackers want — your SSH keys, AWS credentials, GitHub tokens, npm tokens, browser cookies, wallet files, agent configs — and tells you when they're read or written, by what, with which agent in the ancestry. After the fact. You decide what to do.

## What it does

**Runtime filesystem watcher.** A lightweight daemon using `fanotify` on Linux and `fsevents` on macOS that watches a curated set of high-value paths.

**Agent-aware process attribution.** When something fires, the daemon walks the process tree to PID 1, captures argv + environment, and classifies the ancestry: was this an interactive shell, a Claude Code subprocess, a package manager's postinstall, an editor? That classification is what takes the alert volume from 30/day to 1/week.

**Notifications.** Native OS notifications (`notify-send` / Notification Center) with a small set of actions: allowlist this combo, snooze. **Phrased in past tense** — the read already happened. We tell you it happened; we don't pretend to prevent it.

**Snooze.** Two flavors: "shut up about *this* combo" and "shut up about *everything* for a while." Hard 24-hour ceiling. The store log is never silenced — only attention is.

**Local TUI.** Everything is logged to SQLite. `tripwire tui` is a terminal inspector that shows the timeline, lets you investigate evidence, and manages allowlists and snoozes, reading the store directly.

**IoC enrichment.** A daily seeder pulls public IoC feeds (Aikido, OSV, GitHub Advisory) so when a flagged package fires a runtime rule, the notification tells you *which campaign* the package is associated with.

## What it does NOT do

- **It does not block.** Tripwire is a notifier. The read has already completed when you see the alert. If you need to block at install time, run Aikido Safe Chain or Socket Firewall *as well* — they're free and they do that well.
- **It does not wrap your package manager.** No PATH shims, no install-time hooks, no risk of breaking `npm`.
- **It is not antivirus.** No signature scanning of binaries.
- **It is not a sandbox.** Your dev environment runs as normal; tripwire observes.

This is depth-in-defense for the 95% case: opportunistic supply-chain attacks and post-install credential harvesting. A determined attacker with root, a kernel rootkit, or a compromised signed system binary will bypass tripwire.

## How it complements Aikido Safe Chain and Socket Firewall

These are install-time blockers. They sit in front of `npm install` and refuse to let known-bad packages enter your project.

Tripwire sits at runtime. It watches what installed packages actually *do* — what they read, what they write, what they spawn — and tells you when that behavior is interesting.

Together they cover both moments:

| Moment | Tool |
|--------|------|
| Package is about to be installed | Aikido Safe Chain / Socket Firewall |
| Installed package reads `~/.ssh/id_rsa` | tripwire |
| Installed package writes `.claude/settings.json` at runtime | tripwire |
| Subprocess of `claude-code` reads `~/.aws/credentials` | tripwire |

Install both. Tripwire deliberately does not duplicate Aikido/Socket's install-time blocking; their work in that space is solid.

## Quick start

```bash
# Install
curl -fsSL https://jmaleonard.github.io/agent-tripwire/install.sh | sh

# Or via npm
npm install -g @jmaleonard/agent-tripwire

# Start the daemon and run the first-run wizard
tripwire setup

# Inspect events live in your terminal
tripwire tui
```

The setup wizard registers the daemon with `launchd` (macOS) or a systemd user unit (Linux), pulls the IoC feeds, prompts for notification permissions, and starts a 60-minute quiet period so you can tune your allowlist before notifications go live.

See [INSTALL.md](./INSTALL.md) for detailed setup, platform notes, and troubleshooting.

## What it catches

Runtime events, attributed by who did them:

| Event | Detection | Typical category |
|-------|-----------|------------------|
| `node` subprocess of `claude-code` reads `~/.aws/credentials` | `cred.aws-credentials-read` + IoC enrichment | `agent-subprocess` |
| `bash` spawned by an `npm install` reads `~/.ssh/id_rsa` | `cred.ssh-private-key-read` | `package-manager-spawned` |
| Postinstall writes `.claude/settings.json` | `persist.claude-settings-write` | `package-manager-spawned` |
| Editor process writes `.vscode/tasks.json` to a project | (allowlisted by default) | `human-shell` |
| Unknown process drops a `~/Library/LaunchAgents/*.plist` | `persist.launchd-plist-drop` | `unknown` |
| Process from a package flagged by Aikido reads any credential | severity bumped to critical via IoC enrichment | any |

See [docs/rules.md](./docs/rules.md) for the full rule reference and authoring guide.

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│                     User's Workstation                          │
│                                                                 │
│  ┌──────────────────┐   ┌────────────────────┐                  │
│  │ Filesystem       │   │ IoC Seeder         │                  │
│  │ Watcher          │   │ (daily, enriches)  │                  │
│  │ fanotify/        │   │ Aikido / OSV /     │                  │
│  │ fsevents         │   │ GHSA / community   │                  │
│  └────────┬─────────┘   └──────────┬─────────┘                  │
│           │                        │                            │
│           ▼                        │                            │
│  ┌────────────────────────────────┐│                            │
│  │ Process Tree Walker            ││                            │
│  │ + Agent Classifier             ││                            │
│  │ (human-shell / agent-          ││                            │
│  │  subprocess / pkg-mgr / ...)   ││                            │
│  └───────────────┬────────────────┘│                            │
│                  ▼                 ▼                            │
│  ┌──────────────────────────────────────┐                       │
│  │ Detection Engine                     │   ┌─────────────────┐ │
│  │ rule eval + allowlist +              │──▶│ Event Store     │ │
│  │ snooze + IoC enrichment              │   │ (SQLite)        │ │
│  └─────┬─────────────────────┬──────────┘   └────────┬────────┘ │
│        │                     │                       │          │
│        ▼                     ▼                       ▼          │
│  ┌────────────┐      ┌──────────────┐      ┌──────────────────┐ │
│  │ Notifier   │      │ Snooze       │      │ TUI + menu-bar   │ │
│  │ native OS  │      │ subsystem    │      │ read the store   │ │
│  │ (toast P2) │      │              │      │                  │ │
│  └────────────┘      └──────────────┘      └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Detection happens at the moment a process touches a watched path:

1. **Watcher fires.** The kernel tells us a process read or wrote a path we care about.
2. **Walker classifies.** We read the process's ancestry — argv, exe path, agent-session env vars — and bucket it (`human-shell`, `agent-subprocess`, `package-manager-spawned`, etc.).
3. **Rule engine evaluates.** Rules can scope by path *and* ancestry category. `ssh` reading `~/.ssh/id_rsa` is fine; an `agent-subprocess` doing the same fires.
4. **Allowlist + snooze.** If the (rule, process-identity) is on the user's allowlist or currently snoozed, we log silently and stop.
5. **Enrichment.** If the responsible package is in the IoC database, we attach attribution: "this package is on Aikido's list as Mini Shai-Hulud."
6. **Notify.** Past-tense native notification. Action buttons: allowlist, snooze.

## Configuration

Configuration lives at `~/.tripwire/config.yaml`. Defaults are tuned for a typical macOS or Linux dev workstation; see the full reference in [agent-tripwire-spec.md §6.13](./agent-tripwire-spec.md).

## Roadmap

- **Phase 0 — IoC seeder** *(in progress)*. Pulls Aikido, OSV, and GitHub Advisory into a local enrichment database.
- **Phase 1 — Runtime watcher + agent attribution** *(in progress, MVP)*. fanotify/fsevents, process tree walker, notifier, snooze, TUI.
- **Phase 2 — Network egress correlation + notification polish.** eBPF correlation of file reads with outbound connections. Tray icon, terminal toast, TUI snooze management.
- **Phase 3–5 — Reach.** Windows support, fleet aggregation, IDE extensions.
- **Phase 6 — Aikido Safe Chain integration.** Read Aikido's local logs and correlate install-time blocks with runtime activity.
- **Phase 7+ — Research.** Synchronous blocking (turning tripwire from notifier into protector). Treated as research, not roadmap.

Full specification: [agent-tripwire-spec.md](./agent-tripwire-spec.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, project layout, and how to add rules, IoC sources, or agent runtime detectors.

The single highest-leverage contribution right now: tuning the default allowlist against real workstation traffic. See CONTRIBUTING for how.

To report a security issue in tripwire itself, see [SECURITY.md](./SECURITY.md).

## A cooperation ask for agent runtimes

Tripwire's agent attribution works best when agent runtimes export a stable identity env var (e.g. `CLAUDE_CODE_SESSION`) into every subprocess they spawn. If you maintain a coding agent (Claude Code, Cursor, Aider, Continue, Cline, etc.), please consider exporting such an env var. It lets defenders attribute file access to specific agent sessions without fragile process-path matching.

## License

TBD. (Apache-2.0 or MIT recommended for ecosystem adoption.)

## Acknowledgments

Built alongside the open ecosystem of supply-chain defenders: Aikido (Safe Chain + the public malware list), Socket, StepSecurity, Snyk, OSV, the GitHub Advisory team. Tripwire's job is to put runtime visibility next to their install-time visibility, not to duplicate it.

— Jared Leonard
