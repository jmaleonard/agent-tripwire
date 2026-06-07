# Installation Guide

agent-tripwire runs on macOS and Linux. Windows support is on the roadmap (Phase 4).

## Requirements

- **Operating system**: macOS 13+ or Linux (any modern distro with glibc ≥ 2.31).
- **Node.js**: ≥ 22 LTS (for the daemon, CLI, and TUI).
- **Shell**: bash, zsh, or fish.
- **Disk**: ~100 MB for the tool plus a small SQLite store.
- **Permissions**: Phase 1 runs entirely as your user. No root needed.
- **macOS only**: ability to grant notification permission to a CLI tool from System Settings.
- **Linux only**: a running freedesktop notification daemon (most desktop environments have one — see below).

## Install

### Recommended: one-shot installer

```bash
curl -fsSL https://jmaleonard.github.io/agent-tripwire/install.sh | sh
```

The installer:

1. Verifies your Node version.
2. Downloads the latest release tarball, verifying its SHA-256 against a pinned manifest signed with Sigstore.
3. Extracts to `~/.tripwire/`.
4. Registers the daemon for autostart with `launchd` (macOS) or as a systemd user unit (Linux).
5. Runs `tripwire setup`.

The installer never modifies anything outside `~/.tripwire/` and (with consent) the launchd / systemd user unit directory.

### Via npm

```bash
npm install -g @jmaleonard/agent-tripwire
tripwire setup
```

### From source

```bash
git clone https://github.com/jmaleonard/agent-tripwire.git
cd agent-tripwire
pnpm install
pnpm build
pnpm link --global
tripwire setup
```

## What the installer does

The installer creates this layout:

```
~/.tripwire/
├── bin/
│   ├── tripwire             # User-facing CLI
│   └── tripwired            # The daemon binary
├── config.yaml              # User config (created on first run)
├── allowlist.yaml           # User allowlist
├── agents.yaml              # Agent runtime definitions (extensible)
├── package-managers.yaml    # Package manager definitions
├── events.db                # SQLite event store
├── iocs.db                  # Local IoC mirror
├── rules/                   # Bundled rule pack
└── tripwire.log
```

Then registers the daemon for autostart:

- **macOS**: `~/Library/LaunchAgents/io.github.jmaleonard.tripwired.plist`. Loaded with `launchctl bootstrap gui/$UID`.
- **Linux (systemd)**: `~/.config/systemd/user/tripwired.service`. Enabled with `systemctl --user enable --now tripwired`.

Unlike v0.1, the installer does **not** wrap your package managers and does not touch your PATH. Calling `npm` does what it has always done; tripwire is observing from the side.

## First-run setup

After installation, `tripwire setup` runs interactively:

1. Confirms the daemon started successfully.
2. **Prompts for notification permission** (see platform sections below).
3. Pulls the latest IoC feeds (Aikido, OSV, GitHub Advisory). First fetch is ~50 MB; subsequent updates are incremental.
4. Activates the **60-minute first-run quiet period**: the store records everything, but native notifications stay off so you can tune your allowlist without being blasted.
5. Asks whether to opt in to the community IoC feed (default: **no**, prominent disclosure — see [community feed spec](./docs/community-feed.md)).
6. Writes `~/.tripwire/config.yaml` with your choices.
7. Prints next steps — run `tripwire tui` to watch events live in your terminal.

Re-run `tripwire setup` to change settings, or edit `~/.tripwire/config.yaml` directly.

## Notification permissions

### macOS

The first time the daemon tries to post a notification, macOS will show a permission prompt. **You must approve.** If you missed it:

1. System Settings → Notifications.
2. Scroll to find `tripwire` (or `terminal-notifier` if you're using the bundled helper).
3. Toggle "Allow Notifications" on.
4. Verify with `tripwire test-notification`.

If notifications are silently dropped, this is almost always the cause. `tripwire doctor` detects missing permission and tells you.

### Linux

`notify-send` requires a running freedesktop notification daemon. Most desktop environments include one:

- GNOME, KDE, XFCE, Cinnamon, MATE, Budgie: built-in. Nothing to do.
- i3, sway, river, Hyprland: install `dunst` or `mako`, run it as a systemd user service.
- Headless (servers, plain WSL2): notifications don't work. Disable the native surface in config; `tripwire status` / `tripwire tui` remain the source of truth.

Check with:

```bash
tripwire test-notification
# Should produce a desktop notification within 2 seconds.
```

If nothing appears and no error is logged, your session probably lacks a notification daemon.

## Verifying installation

```bash
tripwire doctor
```

Checks:

- Daemon is running.
- Event store is writable.
- Notification permission is granted (macOS) / a notification daemon is reachable (Linux).
- IoC feeds were refreshed in the last 48 hours.
- The fanotify helper (Linux) or fsevents subsystem (macOS) is active.

Fire an end-to-end test event:

```bash
tripwire test-event
# Writes a synthetic event into the store, fires the notifier.
# You should see a desktop notification labeled "tripwire test event"
# and the event in `tripwire tui` (or `tripwire status`).
```

## Uninstall

```bash
tripwire uninstall
```

This:

1. Stops the daemon.
2. Removes the launchd plist (macOS) or systemd unit (Linux).
3. **Prompts** before removing `~/.tripwire/events.db` and `~/.tripwire/iocs.db`.
4. Leaves `~/.tripwire/config.yaml` and `~/.tripwire/allowlist.yaml` unless you pass `--purge`.

If you installed via npm:

```bash
tripwire uninstall
npm uninstall -g @jmaleonard/agent-tripwire
```

## Troubleshooting

### Daemon doesn't start

```bash
tripwire doctor
launchctl print gui/$UID/io.github.jmaleonard.tripwired         # macOS
systemctl --user status tripwired                       # Linux
tail -f ~/.tripwire/tripwire.log
```

### No notifications, but events still show up

Almost always a permission problem:

- macOS: System Settings → Notifications → enable for tripwire / terminal-notifier.
- Linux: ensure a notification daemon is running (`pgrep dunst`, `pgrep mako`, or check your DE).

If permissions are fine, check whether you're inside a snooze:

```bash
tripwire snooze list
tripwire snooze clear
```

Check if you're still inside the first-run quiet period:

```bash
tripwire status | grep -i quiet
```

The quiet period is implemented as a snooze record — `tripwire snooze clear` ends it immediately if you want to skip the soak.

### IoC feed refresh fails

```bash
tripwire feeds status
tripwire feeds refresh --verbose
```

You can run fully offline with the bundled IoC snapshot:

```yaml
# ~/.tripwire/config.yaml
feeds:
  offline_mode: true
```

The bundled snapshot is updated with each tripwire release.

### `tripwire tui` shows nothing / "needs an interactive terminal"

```bash
tripwire status          # non-interactive view; works anywhere (pipes, CI)
tripwire tui             # the live UI; requires a real TTY
```

### Snooze indicator banner in every new shell is annoying

The shell-banner indicator is opt-in. To disable:

```yaml
snooze:
  shell_banner: false
```

Also remove the line the installer appended to your shell rc (`# Added by agent-tripwire (snooze banner)`).

### `fanotify` permission denied on Linux

The daemon uses fanotify in notification mode against user-owned paths, which doesn't require `CAP_SYS_ADMIN`. If you see permission errors, you're probably trying to watch a path outside your home. Adjust `watcher.watch_reads` in config; cross-user / system path coverage is out of scope for v1.

### "permission denied" on macOS

macOS may quarantine downloaded binaries:

```bash
xattr -dr com.apple.quarantine ~/.tripwire/bin/
```

The one-shot installer handles this automatically; only relevant if you installed manually from a tarball.

### Corporate networks with TLS interception

If your organization MITMs HTTPS with a custom root CA, IoC feed fetches may fail:

```yaml
feeds:
  ca_bundle: /etc/ssl/certs/corporate-ca-bundle.pem
```

## Platform notes

### macOS

- Tested on macOS 13 (Ventura), 14 (Sonoma), 15 (Sequoia).
- Apple Silicon and Intel.
- **Read events on macOS are best-effort.** macOS gates read monitoring behind the Endpoint Security entitlement, which Apple does not grant to non-enterprise developers. We watch writes faithfully and infer reads via process behavior; this is documented as a known gap, not papered over.
- Notification permission must be granted in System Settings. First-run setup attempts to trigger the prompt.

### Linux

- Tested on Ubuntu 22.04+, Debian 12+, Fedora 39+, Arch.
- Watcher uses `fanotify` in notification mode. User-owned paths work without elevated capabilities; cross-user / system path coverage would require `CAP_SYS_ADMIN`, which we don't take in v1.
- The Phase 2 network correlator requires kernel ≥ 5.8.
- A freedesktop notification daemon must be running for native notifications. See the Linux notification section above.
- On SELinux-enforcing systems (Fedora, RHEL), the daemon may need a context label. The installer detects this and prints instructions.

### WSL2

Works as Linux. Caveats:

- Filesystem events across the Windows↔Linux boundary are unreliable; tripwire only watches paths inside the WSL filesystem.
- No GUI session means no notification daemon by default. Either install `dunst` and forward to Windows (complex) or disable the native notification surface and rely on `tripwire status` / `tripwire tui`.

## Upgrading

```bash
tripwire update
```

Pulls the latest release, verifies signature, swaps binaries atomically, restarts the daemon, refreshes the bundled rule pack and IoC snapshot. Your config, allowlist, snoozes, and event history are preserved.

Subscribe to releases on GitHub or follow the RSS feed at `https://github.com/jmaleonard/agent-tripwire/releases.atom` for notifications.
