# agent-tripwire — Technical Specification

**Working name:** `agent-tripwire` (rename freely)
**Owner:** Dawnika
**Status:** Draft v0.2 — scope rewrite, 2026-05-16
**Target consumer:** Claude Code

---

## Scope rewrite summary (read first)

v0.1 of this spec described a tool that wrapped `npm` / `pnpm` / `yarn` / `pip` / `uv`, scanned packages at install time, and aborted the install on critical findings. **That framing is removed.**

Reasons:

1. Install-time blocking is a solved space — Aikido Safe Chain (open source, ~200k weekly npm downloads, free) and Socket Firewall already do it well.
2. The real gap is runtime detection on developer workstations. No one currently runs a daemon on the dev machine that watches sensitive paths and tells the user when something reads them.
3. The product intent is honest, after-the-fact awareness. "Hey, this thing just read your SSH key — you okay with that?" The user decides. We don't block; we report.

The new positioning: tripwire is the runtime layer Aikido Safe Chain doesn't have. Recommended to be installed *alongside* it, not instead of.

## 1. Purpose

A **detection-only notifier daemon** for developer workstations that catches malicious code attempting to read sensitive files, modify agent/IDE configs, or exfiltrate credentials — with a focus on the wave of npm/PyPI supply-chain attacks targeting AI coding agents.

The daemon watches a curated set of high-value paths at runtime, attributes every event to a process (and its agent/package-manager ancestry), and emits a past-tense notification when interesting things happen. It does **not** wrap your package manager, hook your install scripts, or block any operation. Findings stream to a local event store with a web dashboard, with optional fleet aggregation.

This is the runtime layer that install-time blockers (Aikido Safe Chain, Socket Firewall) deliberately do not cover. The product is positioned to be installed *alongside* them.

## 2. Threat Model

We are defending the **user's ability to notice** the following, in priority order:

1. **Runtime credential exfiltration** from packages already installed — postinstall-spawned harvesters, runtime workers, or workers reactivated three hours after install. They read `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.npmrc`, `~/.docker/config.json`, browser cookies, wallet files, and exfil to attacker hosts.
2. **Persistence drops via AI agent / IDE configs** — malware that writes `.claude/settings.json`, `.vscode/tasks.json`, shell rc files, or launchd/systemd units to re-execute on next IDE/agent open.
3. **Agent-routed / MCP-routed hijacking** — malicious processes that intercept agent ↔ model traffic or sit in an MCP path to inject `curl | bash` or `pip install` payloads mid-stream. We observe the resulting filesystem and process activity, not the wire itself.
4. **Compromised npm/PyPI packages in active use** — the same as (1) but with IoC-feed attribution: when the package whose subprocess just read `~/.aws/credentials` is on Aikido's malware list, the notification tells you so.

We are **not** defending against:

- A determined attacker with root/admin on the box.
- Kernel-level rootkits.
- Compromised, signed Apple/Microsoft system binaries.
- Network-layer attacks (TLS interception with a trusted CA already installed, etc.).
- Trusted agents (Claude Code, Cursor, etc.) performing intended actions on user-owned files — the allowlist and ancestry-classifier are designed so these are silent.
- **Anything happening at install time before the daemon would have seen it.** That's Aikido / Socket's job, not ours.

## 3. Non-Goals

- Install-time blocking, install-time scanning, install-time wrapping of `npm`/`pnpm`/`yarn`/`pip`/`uv`. The wrap-the-package-manager design from v0.1 is removed in full.
- Antivirus-style signature matching of binaries.
- Sandboxing the user's full development environment.
- Synchronous blocking of any kind (deferred to Phase 7+ as a research item).
- Windows support in Phase 1.
- Cloud-only operation. The tool must be useful 100% offline (cached IoC feeds, local rules, local dashboard).

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     User's Workstation                          │
│                                                                 │
│  ┌──────────────────┐   ┌────────────────────┐                  │
│  │ Filesystem       │   │ IoC Seeder         │                  │
│  │ Watcher          │   │ (Phase 0)          │                  │
│  │ fanotify (Linux) │   │ daily; Aikido /    │                  │
│  │ fsevents (mac)   │   │ OSV / GHSA / comm. │                  │
│  └────────┬─────────┘   └──────────┬─────────┘                  │
│           │                        │                            │
│           ▼                        │                            │
│  ┌─────────────────────────────┐   │                            │
│  │ Process Tree Walker         │   │                            │
│  │ + Agent Classifier          │   │                            │
│  └─────────────┬───────────────┘   │                            │
│                ▼                   ▼                            │
│  ┌──────────────────────────────────────┐                       │
│  │ Detection Engine                     │   ┌─────────────────┐ │
│  │ rule eval + allowlist + snooze       │──▶│ Event Store     │ │
│  │ + IoC enrichment                     │   │ (SQLite)        │ │
│  └─────┬─────────────────────┬──────────┘   └────────┬────────┘ │
│        │                     │                       │          │
│        ▼                     ▼                       ▼          │
│  ┌────────────┐      ┌──────────────┐      ┌──────────────────┐ │
│  │ Notifier   │      │ Snooze       │      │ Local Dashboard  │ │
│  │ native OS  │      │ subsystem    │      │ localhost:7878   │ │
│  │ + tray(P2) │      │              │      │                  │ │
│  └────────────┘      └──────────────┘      └──────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼  (optional, opt-in)
                           ┌────────────────────────┐
                           │  Fleet Aggregator      │
                           │  (user-hosted server)  │
                           └────────────────────────┘
```

### Components

| Component | Phase | Description |
|-----------|-------|-------------|
| `feeds/` | P0 | IoC seeder (OSV, GitHub Advisory, Aikido public list) |
| `rules/` | P0 | YAML rule definitions + bundled IoC snapshot + default allowlist |
| `watcher/` | P1 | Filesystem watcher (`fanotify` on Linux, `fsevents` on macOS) |
| `identity/` | P1 | Process tree walker + agent/package-manager classifier |
| `engine/` | P1 | Rule evaluation, allowlist match, snooze check, IoC enrichment |
| `notifier/` | P1 | Native OS notification surfaces |
| `snooze/` | P1 | Snooze state + duration management |
| `store/` | P1 | SQLite-backed event store + query API |
| `dashboard/` | P1 | Local web UI on `localhost` |
| `cli/` | P1 | User-facing `tripwire` CLI (status, snooze, allowlist, doctor). **Not shims.** |
| `net-correlator/` | P2 | eBPF-based read↔egress correlation |
| `aikido-bridge/` | P6 | Read Aikido Safe Chain's local logs and correlate |
| `blocker/` | P7+ | Research item: synchronous blocking, kernel-level intervention |
| `fleet/` | optional | Self-hosted aggregation server |

The old `cli/` shims for `npm`/`pnpm`/`yarn`/`pip`/`uv` are **removed**. The old `scanner/` package (install-time tarball fetch + tree resolution + static script analysis as a gate) is **removed**.

---

## 5. Phase 0: IoC Feed Seeding (first deliverable)

A thin subsystem that pulls upstream IoC feeds on a daily schedule and merges them into a local enrichment database (`~/.tripwire/iocs.db`).

### 5.1 Scope

- Daily fetch (configurable) from the feeds listed below.
- Merge by `(ecosystem, package, version)` with per-source attribution.
- Bundled snapshot ships with the tool for offline use; refresh is opt-in (defaults to enabled).
- **Enrichment role only.** Feeds never gate anything. The runtime watcher consults `iocs.db` to attach attribution to notifications: "the package whose subprocess just read this is on Aikido's list as Mini Shai-Hulud." Unknown packages still fire rules; the IoC feed makes alerts better, not the alert decision.

### 5.2 Sources

| Feed | URL | Format | Refresh | Notes |
|------|-----|--------|---------|-------|
| Aikido malware list (JS) | `https://malware-list.aikido.dev/malware_predictions.json` | JSON | daily | **Verify license/terms before depending; document attribution in README.** |
| Aikido malware list (Python) | `https://malware-list.aikido.dev/malware_pypi.json` | JSON | daily | Same as above. |
| OSV malicious-packages | https://osv.dev/ (npm + PyPI) | JSON Lines (gz) | daily | |
| GitHub Advisory DB | https://github.com/github/advisory-database | git clone | daily | |
| Community feed (ours) | TBD | signed JSON | hourly | See [docs/community-feed.md](./docs/community-feed.md) |

Implementation note: do **not** depend on any single feed. On feed fetch failure, use the most recent successful snapshot. If all feeds fail, the runtime watcher still works — alerts just lack package-IoC attribution.

### 5.3 Storage

```sql
CREATE TABLE iocs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ecosystem       TEXT NOT NULL,        -- 'npm' | 'pypi'
    package         TEXT NOT NULL,
    version_spec    TEXT NOT NULL,        -- exact version or semver range from source
    sources         TEXT NOT NULL,        -- JSON array of feed names + per-source metadata
    campaign        TEXT,                 -- e.g. 'mini-shai-hulud', 'node-ipc-2026-05'
    first_seen      TEXT NOT NULL,
    last_seen       TEXT NOT NULL,
    UNIQUE(ecosystem, package, version_spec)
);

CREATE INDEX idx_iocs_lookup ON iocs(ecosystem, package);
```

### 5.4 Acceptance criteria

1. `tripwire feeds refresh` pulls all configured feeds; sums to at least the Aikido list size.
2. `tripwire feeds status` shows last-refresh per source, error states, total IoC count.
3. With `feeds.offline_mode: true`, no network calls; the bundled snapshot is used.
4. The merger is deterministic: same inputs → same `iocs.db` rows (modulo timestamps).
5. Per-package lookup `tripwire ioc <package>` returns attribution from all sources that have an entry.

---

## 6. Phase 1: Runtime Filesystem Watcher + Agent Attribution (MVP)

This is the user-facing product. Everything below is in scope for the first PR series after Phase 0.

### 6.1 Scope

A long-running daemon (`tripwired`) that:

1. Watches a configurable set of sensitive paths for read/write events.
2. On every event, walks the process tree to PID 1, captures argv + selected env vars, and classifies the ancestry.
3. Evaluates rules scoped by (path, event-kind, ancestry-category).
4. Checks the user's allowlist and the snooze subsystem.
5. Enriches with IoC attribution from Phase 0.
6. Writes the event to SQLite.
7. Fires a native OS notification (if not snoozed and past the first-run quiet period).

The daemon is the only entry point in v1. There is no `npm` wrapper, no install hook, no PATH manipulation.

### 6.2 File Layout

```
agent-tripwire/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── README.md
├── packages/
│   ├── shared/                   # Cross-package types + utils
│   │   └── src/
│   │       ├── types.ts          # Event, Rule, ProcessIdentity, Snooze, ...
│   │       ├── severity.ts
│   │       └── logger.ts
│   ├── store/                    # SQLite event store + iocs
│   │   └── src/
│   │       ├── schema.sql
│   │       ├── db.ts             # better-sqlite3 wrapper
│   │       ├── events.ts
│   │       ├── snooze.ts
│   │       ├── allowlist.ts
│   │       ├── iocs.ts
│   │       └── migrations/
│   ├── feeds/                    # IoC seeder (Phase 0)
│   │   └── src/
│   │       ├── osv.ts
│   │       ├── github-advisory.ts
│   │       ├── aikido.ts
│   │       ├── community-feed.ts
│   │       └── merger.ts
│   ├── rules/                    # Bundled rule pack + IoC snapshot + allowlist
│   │   ├── patterns/
│   │   │   ├── credential-paths.yaml
│   │   │   ├── agent-config-tampering.yaml
│   │   │   ├── persistence.yaml
│   │   │   └── shell-rc.yaml
│   │   ├── default-allowlist.yaml
│   │   └── iocs/
│   │       └── packages.json
│   ├── watcher/                  # Filesystem watcher
│   │   └── src/
│   │       ├── linux/
│   │       │   ├── fanotify.ts
│   │       │   └── native/       # Helper binary (or N-API)
│   │       ├── macos/
│   │       │   └── fsevents.ts
│   │       ├── interface.ts      # Common FsEvent type
│   │       └── dispatch.ts
│   ├── identity/                 # Process tree walker + agent classifier
│   │   └── src/
│   │       ├── linux/proc.ts     # /proc walker
│   │       ├── macos/proc.ts     # proc_pidinfo walker
│   │       ├── classifier.ts     # ancestry -> category
│   │       ├── agents.yaml       # known agent runtimes
│   │       └── package-managers.yaml
│   ├── engine/                   # Rule evaluation + allowlist + IoC enrichment
│   │   └── src/
│   │       ├── rule-loader.ts
│   │       ├── evaluator.ts
│   │       ├── allowlist.ts
│   │       └── enricher.ts       # adds IoC attribution to events
│   ├── notifier/                 # Native OS notification surfaces
│   │   └── src/
│   │       ├── macos.ts          # osascript / terminal-notifier
│   │       ├── linux.ts          # notify-send / libnotify
│   │       └── interface.ts
│   ├── snooze/                   # Snooze subsystem
│   │   └── src/
│   │       ├── store.ts          # snooze table + active queries
│   │       ├── presets.ts
│   │       └── indicator.ts      # banner for new shells (Phase 1 fallback)
│   ├── dashboard/                # Local web UI
│   │   └── src/
│   │       ├── server/
│   │       │   ├── index.ts      # Hono server
│   │       │   └── routes/
│   │       └── client/
│   │           ├── index.html
│   │           ├── app.tsx
│   │           └── components/
│   └── cli/                      # User-facing `tripwire` CLI (no shims)
│       ├── src/
│       │   ├── setup.ts
│       │   ├── doctor.ts
│       │   ├── snooze.ts
│       │   ├── allowlist.ts
│       │   ├── feeds.ts
│       │   └── status.ts
│       └── bin/
│           └── tripwire
├── schemas/
│   ├── event.schema.json
│   └── rule.schema.json
├── scripts/
│   ├── install.sh
│   └── feed-refresh.sh
└── test/
    ├── fixtures/
    │   ├── ancestry/             # Synthetic process trees
    │   ├── rules/                # Per-rule positive/negative fixtures
    │   └── allowlist-corpus/     # Top-100 sensitive-path workflows for FP testing
    └── integration/
```

### 6.3 Filesystem Watcher

**Linux: `fanotify`** in notification mode. Marks user-owned paths in the user's home directory, no `CAP_SYS_ADMIN` required.

- Notification events for `open`, `read`, `write`, `create`, `unlink`, `rename`.
- For paths outside the user's home (system paths), `CAP_SYS_ADMIN` would be required; we don't go there in v1. The spec documents which watched paths would benefit from cap-elevated coverage but doesn't request it.
- Fallback if fanotify isn't available: a bpftrace/eBPF loader, deferred to Phase 2.

**macOS: `fsevents`** for write/create/rename events.

- Read events on macOS require the Endpoint Security entitlement, which Apple does not grant to non-enterprise developers. We don't pursue that entitlement in v1.
- Honest consequence: **macOS reads are best-effort.** We catch some reads indirectly via process behavior (e.g. an opt-in DTrace helper) but we don't promise read coverage on macOS. Documented in INSTALL.md and SECURITY.md.

Output of the watcher: a stream of `FsEvent { path, kind, pid, timestamp }` objects, normalized across platforms. The watcher does no rule evaluation; that's the engine's job.

### 6.4 Agent-Aware Process Attribution

**This is the core differentiator of the product.** The watcher gives us a PID; the identity package turns that PID into a meaningful classification that rules and the user can reason about.

#### 6.4.1 Process identity tuple

Every event is tagged with a stable tuple:

```typescript
interface ProcessIdentity {
  pid: number;                              // ephemeral; for current event only
  process_path: string;                     // canonical exe path
  argv: string[];                           // truncated to first 32 args
  parent_agent_session_id: string | null;   // e.g. CLAUDE_CODE_SESSION env value, if present in any ancestor
  ancestry_summary_hash: string;            // stable hash over the ancestry chain (paths + argv[0])
  category: AncestryCategory;
}

type AncestryCategory =
  | 'human-shell'
  | 'agent-direct'
  | 'agent-subprocess'
  | 'package-manager-direct'
  | 'package-manager-spawned'
  | 'unknown';
```

The `ancestry_summary_hash` is the key that snooze and allowlist scope against. It's stable as long as the process tree stays alive (so "snooze for 15 minutes" survives the same agent session) and changes when the agent session ends (so a stale snooze can't survive into a different work context).

#### 6.4.2 Walker

1. On event, read `/proc/<pid>/{status,cmdline,exe,environ}` (Linux) or call `proc_pidinfo` + `proc_pidpath` + `KERN_PROCARGS2` (macOS) for the firing process.
2. Walk parent → PID 1, capturing each level's executable path and `argv[0]`.
3. Scan environment variables across the ancestry for a configurable identity-marker allowlist:

```yaml
identity:
  env_markers:
    - CLAUDE_CODE_SESSION
    - CURSOR_SESSION
    - AIDER_SESSION
    - CONTINUE_SESSION
    - ANTHROPIC_AGENT_RUN
  agent_paths:                             # fallback when env markers are missing
    - /Applications/Claude.app/Contents/MacOS/claude-code
    - /Applications/Cursor.app/Contents/MacOS/Cursor
    - "${HOME}/.local/share/aider/bin/aider"
  package_manager_paths:
    - "*/bin/npm"
    - "*/bin/pnpm"
    - "*/bin/yarn"
    - "*/bin/pip"
    - "*/bin/uv"
```

4. Compute `ancestry_summary_hash` as SHA-256 of the chain of `{exe_path, argv[0]}` from root down.

#### 6.4.3 Classifier

Given the walked ancestry:

| Category | Condition |
|----------|-----------|
| `human-shell` | Top of ancestry is an interactive shell (`zsh`/`bash`/`fish`) whose parent is a terminal emulator; nothing else matches below. |
| `agent-direct` | The firing process *is* a known agent binary. |
| `agent-subprocess` | Any ancestor matches `agent_paths` or has an `env_markers` value. |
| `package-manager-direct` | The firing process is a known package manager binary. |
| `package-manager-spawned` | Any ancestor is a known package manager, firing process is not. |
| `unknown` | Nothing matched. |

If multiple categories could apply, `agent-subprocess` takes precedence over `package-manager-spawned` (an agent that ran `npm install` is still ultimately driven by the agent). Order documented in `classifier.ts` and locked in by tests.

Rules in [docs/rules.md](./docs/rules.md) scope by category, e.g. "alert on read of `~/.aws/credentials` only when category is `agent-subprocess` or `package-manager-spawned`." **This is what takes the alert volume from 30/day to 1/week.**

#### 6.4.4 Cooperation ask

Env-var-based identity is reliable only if agent runtimes cooperate by exporting identity env vars. Without that, we fall back to process-path matching against `agents.yaml`, which is fragile and rots over time.

**The README and a public "for agent runtime authors" page document the cooperation ask:** export `CLAUDE_CODE_SESSION` (or equivalent) into the env of any subprocess you spawn, so runtime detection daemons can attribute file access to your session. This is a docs/community deliverable, not a code one, but it's the long-term play.

### 6.5 Detection Rules — Phase 1 Rule Pack

Rules live in YAML under `packages/rules/patterns/`. Schema in `schemas/rule.schema.json`. The full authoring guide is in [docs/rules.md](./docs/rules.md); the shape relevant here:

```yaml
id: cred.aws-credentials-read
name: "AWS credentials file read"
severity: high
category: credential-access
description: |
  A process read ~/.aws/credentials. Sensitive unless the process is the
  AWS CLI or an explicitly allowlisted tool.
applies_to:
  event_kind: [read, open]
  path:
    home_relative: [".aws/credentials", ".aws/config"]
  ancestry_category:
    not_in: [human-shell]   # human shells using `aws` directly are allowlisted by default
references:
  - https://example.com/aws-cred-exfil-writeup
```

The bundled rule pack covers:

- **`credential-paths.yaml`** — `cred.ssh-private-key-read`, `cred.aws-credentials-read`, `cred.gh-token-read`, `cred.npmrc-read`, `cred.docker-config-read`, `cred.netrc-read`, `cred.browser-cookie-read`, `cred.wallet-file-read`.
- **`agent-config-tampering.yaml`** — `persist.claude-settings-write`, `persist.vscode-tasks-write` (writes from non-editor ancestry only).
- **`persistence.yaml`** — `persist.shell-rc-modification`, `persist.cron-modification`, `persist.launchd-plist-drop` (macOS), `persist.systemd-unit-drop` (Linux).
- **`shell-rc.yaml`** — granular shell rc rules with editor-ancestry allowlisting.

Rules are evaluated against runtime filesystem events. The old rule families that scanned tarballs (`shai-hulud.preinstall-encrypted-payload`, `net.curl-bash`, `obf.eval-of-decoded`) are **removed** from the v1 rule pack. They may return in a future static rule pack if a static scanner subsystem is reintroduced, but they have no role in Phase 1.

### 6.6 Notification System

Three surfaces, configurable per surface, **all on by default** (with the per-surface caveats noted):

| Surface | Phase | Notes |
|---------|-------|-------|
| Local dashboard | P1 | Source of truth. Every event logged here first, always. Unacknowledged events shown on next dashboard open. |
| Native OS notification | P1 | macOS via `osascript` / `terminal-notifier`; Linux via `notify-send` / libnotify. |
| Terminal toast | **P2** | Writes to the user's active TTYs. Footgun risk (interrupting an edit). Deferred behind a flag; the Phase 1 build ships with dashboard + native only. |

#### 6.6.1 Phrasing — past tense, always

The read already happened. The notification tells the user it happened, not that we prevented it. Contract:

- ✅ "claude-code (pid 4421) just read `~/.aws/credentials`"
- ❌ "claude-code is trying to read `~/.aws/credentials`"
- ❌ "Blocking claude-code from reading `~/.aws/credentials`"

The dashboard, the snippets in docs, the README copy, snooze copy, allowlist copy, and CLI output all follow this rule. The first time a user realizes the read already completed when we said "trying to," trust erodes.

#### 6.6.2 Notification body

```
[tripwire] claude-code (pid 4421) just read ~/.aws/credentials
            ancestry: claude-code → bash → npm exec → some-tool
            package: some-tool@1.4.2 (flagged by Aikido as mini-shai-hulud)
            rule: cred.aws-credentials-read
            [Open dashboard]  [Allowlist this combo]  [Snooze this ▾]  [Snooze ALL ▾]
```

Phase 1 actions:

| Action | Behavior |
|--------|----------|
| Open dashboard | Opens `http://localhost:7878/events/<id>` |
| Allowlist this combo | Adds `(rule_id, ancestry_summary_hash)` to the allowlist |
| Snooze this ▾ | Submenu of duration presets; snoozes `(rule_id, process_identity_tuple)` |
| Snooze ALL ▾ | Submenu of duration presets; snoozes all notification surfaces |

Clicking the notification body itself (not an action button) opens the dashboard scrolled to that event. Maps natively on both macOS and Linux.

#### 6.6.3 Actions explicitly deferred

**Kill process** and **Rotate credential** are deferred to later phases. They require capabilities (process termination permissions, credential-type-specific rotation flows) we don't want to block v1 on. The spec explicitly calls them out as "the actions that turn the tool from notifier into protector," so the trajectory is clear without overcommitting.

### 6.7 Snooze System

Two flavors, both invocable from the notification:

| Type | Scope | Use case |
|------|-------|----------|
| **Snooze this** | `(rule_id, process_identity_tuple)` | "Yes, what *this* claude-code session is doing is fine for now." |
| **Snooze ALL** | All notification surfaces | "I'm pairing right now. Shut up about everything." |

#### 6.7.1 Scope choice rationale

Snooze-this scopes by the **process identity tuple** — `(parent_agent_session_id_if_any, process_path, ancestry_summary_hash)` — not by rule alone or rule + process name. Reasons:

- "I'm okay with what *this* Claude Code session is doing" should not weaken security against an unrelated `node` process reading the same path.
- The ancestry hash is stable across short windows but doesn't survive process restart or new agent session. Snoozes naturally expire when the work ends. No stale "I allowlisted this six months ago" problem.

#### 6.7.2 Durations

Default presets: **5 min, 15 min, 1 hour, 4 hours, until tomorrow 9am.**

Hard ceiling: **24 hours.** No "snooze for a week." Forces re-decide daily.

```yaml
snooze:
  presets: [5m, 15m, 1h, 4h, until_morning]
  morning_time: "09:00"
  max_duration: 24h
```

#### 6.7.3 What snooze does NOT do

**Snoozes never silence the dashboard log.** They suppress native + terminal notification surfaces only. Every event is still recorded, queryable, and visible in the dashboard timeline with a small `snoozed` badge. **Snooze is about attention, not about evidence.** This is the single most important property of the system, and it's enforced in code: the notifier checks the snooze table; the store does not.

#### 6.7.4 Visible snooze indicator

The user must be able to see snooze state without opening the dashboard.

- **Preferred (Phase 2):** menu-bar icon (macOS) or system-tray icon (Linux) showing snooze state with one-click clear.
- **Phase 1 fallback:** startup terminal banner whenever a new shell opens, via a small shell snippet the installer optionally appends to the rc:

```
⚠ tripwire: notifications snoozed for 3h22m more.
            Run `tripwire snooze clear` to unsuppress.
```

The shell banner is opt-in (off by default for users who don't want shell startup chatter). Snooze state is also visible via `tripwire snooze list`.

#### 6.7.5 CLI

```bash
tripwire snooze list           # active snoozes
tripwire snooze clear          # clear all
tripwire snooze clear <id>     # clear one
tripwire snooze add <window>   # manual snooze ALL
tripwire snooze add <window> --rule <id> --identity <hash>   # manual snooze this
```

Dashboard snooze management (list / clear UI) is deferred to Phase 2. CLI is enough for v1.

### 6.8 First-Run Quiet Period

On first daemon start: **no native notifications fire for the first 60 minutes.** Dashboard-only. Default on; configurable.

Why:

- New installs have an untuned allowlist.
- The first hour of normal activity will generate false positives the user hasn't allowlisted yet.
- Without the quiet period, the user gets blasted, dismisses everything reflexively, and uninstalls by day 2.
- The quiet period lets the dashboard fill with examples the user can review, bulk-allowlist, and *then* turn notifications on for real.

Implementation: the quiet period is just a special snooze record (kind=`all`, expires=now+60min) inserted by `tripwire setup`. The user can see and clear it like any other snooze.

Setup-wizard copy at install end:

> Quiet mode active for 60 min so you can tune your allowlist. Open the dashboard to review what's firing, then notifications go live.

Power-user opt-out:

```yaml
first_run:
  quiet_period_minutes: 60   # 0 to disable
```

### 6.9 Default Allowlist (engineering challenge)

**Allowlist tuning is the make-or-break engineering work of this product.** A bundled default that's too aggressive misses real attacks; one that's too permissive drowns the user in noise. The default ships covering the common, boring case — and contributors are encouraged to expand it against real workstation traffic.

Bundled defaults (representative, not exhaustive):

| Process(es) | Path | Event | Notes |
|-------------|------|-------|-------|
| `ssh`, `sshd` | `~/.ssh/*` | read | Standard SSH usage. |
| `git` | `~/.ssh/known_hosts`, `~/.ssh/id_*.pub` | read | Public keys + known hosts only; `git` reading a private key is **not** allowlisted. |
| `gh` | `~/.config/gh/hosts.yml` | read | GitHub CLI auth. |
| `aws` (CLI) | `~/.aws/credentials`, `~/.aws/config` | read | AWS CLI. |
| `docker` | `~/.docker/config.json` | read | Docker config. |
| `npm`, `pnpm`, `yarn` | `~/.npmrc` | read | **Only when category is `package-manager-direct`.** Package manager direct invocation only; their spawned children reading `.npmrc` is *not* allowlisted. |
| Editor processes (VS Code, vim, emacs, Cursor, Claude Code app) | `**/.claude/settings.json`, `**/.vscode/tasks.json` | read, write | Editor usage. Writes from non-editor ancestry still fire the persistence rule. |

Format: YAML; see `packages/rules/default-allowlist.yaml`.

Tuning the default allowlist against real workstation traffic is explicitly called out in `CONTRIBUTING.md` as the highest-leverage review contribution. There is no shortcut to a quiet, useful tool here — it's a corpus problem that improves with breadth of contributor traffic.

### 6.10 Event Schema

`schemas/event.schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "TripwireEvent",
  "type": "object",
  "required": ["event_id", "timestamp", "source", "severity", "rule_id", "identity"],
  "properties": {
    "event_id":   { "type": "string", "format": "uuid" },
    "timestamp":  { "type": "string", "format": "date-time" },
    "source":     { "type": "string", "enum": ["fs_watcher", "net_correlator", "manual"] },
    "severity":   { "type": "string", "enum": ["critical", "high", "medium", "low", "info"] },
    "rule_id":    { "type": "string" },
    "rule_name":  { "type": "string" },
    "path":       { "type": "string" },
    "event_kind": { "type": "string", "enum": ["read", "write", "open", "create", "unlink", "rename"] },
    "identity": {
      "type": "object",
      "required": ["pid", "process_path", "ancestry_summary_hash", "category"],
      "properties": {
        "pid":                     { "type": "integer" },
        "process_path":            { "type": "string" },
        "argv":                    { "type": "array", "items": { "type": "string" } },
        "parent_agent_session_id": { "type": ["string", "null"] },
        "ancestry_summary_hash":   { "type": "string" },
        "category": {
          "type": "string",
          "enum": ["human-shell", "agent-direct", "agent-subprocess",
                   "package-manager-direct", "package-manager-spawned", "unknown"]
        },
        "ancestry_summary": { "type": "array", "items": { "type": "string" } }
      }
    },
    "package": {
      "description": "Best-effort attribution: which installed package contained the firing executable.",
      "type": "object",
      "properties": {
        "ecosystem": { "type": "string", "enum": ["npm", "pypi", "other"] },
        "name":      { "type": "string" },
        "version":   { "type": "string" },
        "ioc_attribution": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "source":   { "type": "string" },
              "campaign": { "type": "string" }
            }
          }
        }
      }
    },
    "snoozed":     { "type": "boolean", "default": false },
    "notified":    { "type": "boolean", "default": false },
    "user_action": {
      "type": "string",
      "enum": ["pending", "allowlisted", "dismissed", "investigated"]
    }
  }
}
```

### 6.11 Event Store

SQLite via `better-sqlite3`. WAL mode. Default location: `~/.tripwire/events.db`.

```sql
CREATE TABLE events (
    event_id              TEXT PRIMARY KEY,
    timestamp             TEXT NOT NULL,
    source                TEXT NOT NULL,
    severity              TEXT NOT NULL,
    rule_id               TEXT NOT NULL,
    rule_name             TEXT,
    path                  TEXT,
    event_kind            TEXT,
    pid                   INTEGER,
    process_path          TEXT,
    parent_agent_session  TEXT,
    ancestry_hash         TEXT NOT NULL,
    ancestry_category     TEXT NOT NULL,
    ancestry_json         TEXT,
    package_eco           TEXT,
    package_name          TEXT,
    package_version       TEXT,
    ioc_attribution       TEXT,                    -- JSON
    snoozed               INTEGER NOT NULL DEFAULT 0,
    notified              INTEGER NOT NULL DEFAULT 0,
    user_action           TEXT DEFAULT 'pending'
);

CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_severity  ON events(severity);
CREATE INDEX idx_events_ancestry  ON events(ancestry_hash);

CREATE TABLE allowlist (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    scope           TEXT NOT NULL,                 -- 'rule+ancestry' | 'rule+process' | 'rule'
    rule_id         TEXT,
    ancestry_hash   TEXT,
    process_path    TEXT,
    path_pattern    TEXT,
    reason          TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE snoozes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    kind            TEXT NOT NULL,                 -- 'this' | 'all'
    rule_id         TEXT,
    ancestry_hash   TEXT,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL,
    reason          TEXT
);

CREATE INDEX idx_snoozes_expires ON snoozes(expires_at);

CREATE TABLE iocs (
    -- as in §5.3
);
```

### 6.12 Dashboard

Single-page app served by a Hono server on `http://localhost:7878` (port configurable).

**Routes:**
- `GET /` — UI shell.
- `GET /api/events?since=&severity=&category=&limit=` — paged event list.
- `GET /api/events/:id` — full event detail.
- `POST /api/events/:id/action` — record user action (allowlist, dismiss, mark-investigated).
- `GET /api/summary` — counts by severity, top packages, top ancestry categories, recent activity.
- `GET /api/allowlist` / `POST /api/allowlist` / `DELETE /api/allowlist/:id`.
- `GET /api/snoozes` / `POST /api/snoozes` / `DELETE /api/snoozes/:id`.
- `GET /api/iocs?package=` — IoC lookup.
- `POST /api/feeds/refresh` — manually trigger feed refresh.

**UI views (minimum):**
1. **Timeline** — reverse-chronological events with severity, category, ancestry summary, rule, IoC attribution. `snoozed` badge on suppressed events.
2. **Event detail** — full ancestry chain, IoC attribution, allowlist action.
3. **Allowlist** — managed exceptions.
4. **Feeds** — last refresh time, error states.
5. **Snoozes (basic list view)** — full management UI deferred to Phase 2.

Preact + Tailwind. No SSR. Server is read-mostly; writes go through narrow JSON endpoints.

### 6.13 Configuration

`~/.tripwire/config.yaml`:

```yaml
version: 2

daemon:
  autostart: true                  # register with launchd/systemd
  log_file: ~/.tripwire/tripwire.log
  log_level: info

watcher:
  watch_reads:
    - ~/.ssh
    - ~/.aws
    - ~/.config/gh
    - ~/.netrc
    - ~/.npmrc
    - ~/.docker/config.json
    - ~/.config/claude
    - ~/Library/Application Support/Google/Chrome/*/Cookies   # macOS
    - ~/.config/google-chrome/*/Cookies                       # Linux
  watch_writes:
    - "**/.claude/settings.json"
    - "**/.vscode/tasks.json"
    - ~/.bashrc
    - ~/.zshrc
    - ~/.profile
    - ~/.config/fish/config.fish
    - ~/Library/LaunchAgents
    - ~/.config/systemd/user

identity:
  env_markers:
    - CLAUDE_CODE_SESSION
    - CURSOR_SESSION
    - AIDER_SESSION
    - CONTINUE_SESSION
  agents_file: ~/.tripwire/agents.yaml
  package_managers_file: ~/.tripwire/package-managers.yaml

rules:
  packs: [default]
  disabled: []

notifier:
  surfaces:
    dashboard: true
    native:    true
    terminal:  false                # Phase 2

snooze:
  presets: [5m, 15m, 1h, 4h, until_morning]
  morning_time: "09:00"
  max_duration: 24h
  shell_banner: false               # opt-in shell startup banner

first_run:
  quiet_period_minutes: 60

allowlist_file: ~/.tripwire/allowlist.yaml

feeds:
  enabled: [aikido, osv, github-advisory]
  refresh_interval_hours: 24
  offline_mode: false

dashboard:
  enabled: true
  host: 127.0.0.1
  port: 7878
  auto_open: false

community_feed:
  enabled: false
  endpoint: "https://feed.tripwire.dawnika.dev/submit"
  batch_interval_hours: 6
  batch_jitter_minutes: 30

fleet:
  enabled: false
```

### 6.14 Tech Stack

Unchanged from v0.1:

- **Language:** TypeScript, Node ≥ 22 LTS.
- **Build:** pnpm workspaces, `tsup`.
- **Database:** SQLite via `better-sqlite3`.
- **Web server:** Hono.
- **Frontend:** Preact + Vite + Tailwind.
- **YAML rules:** `yaml` package, validated with `ajv` against `rule.schema.json`.
- **Logging:** `pino`.
- **Testing:** `vitest`, integration tests against fixture process trees and fixture filesystem events.

Net-new:

- **Filesystem watching:** `fanotify` via a small helper binary (recommended: Rust, JSON-over-stdio protocol) on Linux; `fsevents` (built-in) on macOS.
- **Process tree walking:** `/proc` reads on Linux; `libproc` (`proc_pidinfo` / `KERN_PROCARGS2`) on macOS.
- **Native notifications:** `osascript` / `terminal-notifier` (macOS); `notify-send` / libnotify (Linux).

### 6.15 Acceptance Criteria

The Phase 1 build is complete when:

1. **Daemon installs and starts** via `tripwire setup` on macOS and Linux; survives reboot via launchd / systemd user unit.
2. **End-to-end event** fires: writing a fixture file under `~/.ssh/test-tripwire-id_rsa` from a non-allowlisted process produces a dashboard event *and* a native notification within 2 s.
3. **Agent attribution works:** a `node` process spawned by an env-marked `claude-code` parent is classified as `agent-subprocess`; verified by integration test with a synthetic ancestry.
4. **Snooze respects scope:** a "snooze this" on a fixture process tree silences future fires from that same tree; an unrelated process firing the same rule still notifies.
5. **Snooze never silences dashboard:** every snoozed event is still in `events.db` with `snoozed=1`.
6. **First-run quiet period works:** no native notifications for the first 60 minutes after `tripwire setup`; dashboard logs are unaffected.
7. **IoC enrichment:** an event from a package on the Aikido list has `ioc_attribution` populated; verified against a fixture.
8. **Offline mode:** with `feeds.offline_mode: true`, daemon runs against bundled snapshot, no network calls.
9. **False positive ceiling:** on a curated "top-100 sensitive-path-touching workflows" corpus (ssh sessions, normal `aws` invocations, normal editor activity, normal `npm install`), default allowlist produces **zero** non-info-severity events.
10. **Uninstall is clean:** `tripwire uninstall` removes daemon registration, prompts before removing the events DB.
11. **Test coverage** ≥ 80% on `watcher/`, `identity/`, `engine/`, `notifier/`, `snooze/`.

### 6.16 Testing Strategy

- **Unit:** every classifier branch has fixtures; every rule has positive and negative fixtures; snooze and allowlist have time-machine tests using a fake clock.
- **Integration:** synthetic process trees (spawn `bash` → `node` → file-touch) with controlled env markers; assert ancestry classification and rule firing.
- **End-to-end:** start daemon, touch files, assert event in DB and notification fired (mocked notifier sink for CI).
- **False-positive corpus:** scripted reproduction of the top-100 workstation workflows; CI fails if any produce a non-info event with the default config.
- **CI:** matrix on Ubuntu 22.04 + macOS 14, Node 22 + 24.

### 6.17 Out of Scope for Phase 1

- Network egress correlation (Phase 2).
- Tray-icon / menu-bar snooze indicator (Phase 2).
- Terminal-toast notifications (Phase 2).
- Windows support (Phase 4).
- Aikido Safe Chain integration (Phase 6).
- Synchronous blocking (Phase 7+).

---

## 7. Phase 2: Network Egress Correlation + Notification Polish

eBPF-based correlation: when a process reads a sensitive path (Phase 1 event) and within N seconds opens an outbound TCP connection to a non-allowlisted host, emit a `net.read-then-exfil` event with both legs joined.

Hooks (Linux):
- `tracepoint:syscalls:sys_enter_openat` (filter on sensitive paths)
- `tracepoint:syscalls:sys_enter_connect`

Allowlisted egress destinations: configurable list, defaults to known package registries, cloud API endpoints, etc.

macOS fallback: Network Extension framework requires entitlements we won't have. Settle for known-bad-host detection via DNS resolver inspection or a user-opted-in local DNS proxy. Honest about the coverage gap.

Phase 2 also includes the deferred notification polish:
- Menu-bar (macOS) / system-tray (Linux) icon for snooze indicator.
- Terminal-toast notifications (behind a flag).
- Dashboard snooze-management UI.

---

## 8. Phase 3–5: Reach

Reserved for runtime / distribution polish that doesn't change the product shape:

- Windows support (ETW-based watcher equivalent, identity walker for Windows tokens).
- Fleet aggregation server (separate spec).
- IDE extensions (Claude Code / Cursor surface events inline).

These sit between the MVP (Phase 1) and the Aikido bridge (Phase 6) so the core daemon matures across more platforms before we expand the integration surface.

---

## 9. Phase 6: Integration with Aikido Safe Chain (and similar)

If a user runs Aikido Safe Chain (or Socket Firewall) alongside tripwire, we read the install-time tool's local logs and correlate:

> Aikido blocked package `bad-pkg@1.2.3` at install on 2026-05-14 14:11. Three hours later, `node-process-from-some-other-package@2.0.0` (not blocked) read `~/.ssh/id_rsa`. Possibly related.

This is a much stronger user story than rebuilding the blocker. It lets us:

- Show post-block runtime behavior — did Aikido catch the right thing?
- Highlight near-misses — packages Aikido didn't block but that look related.
- Build a richer case for the user when something escalates.

---

## 10. Phase 7+: Research

Synchronous blocking — turning the notifier into a protector. This is **research**, not roadmap:

- On macOS: Endpoint Security framework, which requires Apple entitlements we don't have. Open question whether any practical path exists for non-enterprise distributions.
- On Linux: `fanotify` permission events (require `CAP_SYS_ADMIN`), eBPF LSM hooks (kernel ≥ 5.7), or an out-of-tree kernel module (don't).
- Cross-cutting: synchronous blocking exposes the user to scanner crashes blocking their normal work. The bar for shipping this is very high.

Treat Phase 7 as a paper before it's a deliverable.

---

## 11. Open Questions for the Build

1. **fanotify integration mechanism** — TypeScript can't call fanotify directly. Native N-API addon (faster, harder to ship) vs. a long-running helper binary with stdio JSON protocol (slower, simpler). Recommendation: helper binary in Rust shipped alongside the daemon.
2. **Aikido list license** — `malware-list.aikido.dev` is publicly served but terms-of-use should be verified before depending on it. Document attribution requirements in README.
3. **Snooze persistence across daemon restart** — store in SQLite (yes). Stored snooze resumes if daemon was restarted within the snooze window; expires normally otherwise.
4. **Notification deduplication** — within a short window, identical events should coalesce in the notification surface (dashboard always shows every event). Recommended: 30 s dedup window keyed on `(rule_id, ancestry_summary_hash, path)`.
5. **macOS notification permission flow** — first-run wizard must successfully trigger the prompt; need to research whether `terminal-notifier` or a small Swift helper is the more reliable trigger.

## 12. How Claude Code Should Approach This Build

Build in this order, each as its own PR series:

1. Monorepo scaffold + `shared/` types + rule schema + event schema.
2. `store/` package — SQLite + migrations + write/read API + tests. Tables: `events`, `allowlist`, `snoozes`, `iocs`.
3. `feeds/` package — Phase 0. Aikido + OSV + GHSA + merger.
4. `watcher/` package — fanotify (via helper binary) on Linux, fsevents on macOS, normalized `FsEvent` stream.
5. `identity/` package — process tree walker + ancestry classifier + agents/package-managers yaml + tests.
6. `engine/` package — rule loader, evaluator, allowlist, snooze check, IoC enrichment.
7. `notifier/` package — native OS surfaces; mock sink for tests.
8. `snooze/` package — store + presets + indicator (shell banner fallback).
9. `cli/` package — `tripwire` CLI: setup, doctor, snooze, allowlist, feeds, status.
10. `dashboard/` package — server + minimal Preact UI.
11. End-to-end integration tests with synthetic ancestries.
12. Installer + first-run wizard + macOS notification permission flow.
13. Documentation: README, INSTALL, rules, contributing, community-feed.

Each PR should: (a) ship with tests, (b) update the README's status section, (c) be reviewable in < 800 LOC of diff where possible.

## 13. References

- Aikido Safe Chain: https://aikido.dev/safe-chain
- Aikido public malware list: https://malware-list.aikido.dev/
- Socket Firewall: https://socket.dev/firewall
- node-ipc 2026-05 supply-chain attack: https://www.stepsecurity.io/blog/node-ipc-npm-supply-chain-attack
- Mini Shai-Hulud / SAP CAP: https://thehackernews.com/2026/04/sap-npm-packages-compromised-by-mini.html
- Shai-Hulud worm self-propagation: https://thehackernews.com/2026/04/self-propagating-supply-chain-worm.html
- OSV: https://osv.dev/
- GitHub Advisory DB: https://github.com/github/advisory-database
- fanotify(7): https://man7.org/linux/man-pages/man7/fanotify.7.html
- Apple Endpoint Security framework: https://developer.apple.com/documentation/endpointsecurity
