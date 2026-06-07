# Tripwire Menubar (macOS)

A tiny native macOS menu-bar app that mirrors the daemon's state.

- `LSUIElement = true` — no Dock icon, no main window.
- One `NSStatusItem` with severity-aware SF Symbol.
- Reads `~/.tripwire/events.db` directly (system SQLite3) every 5 seconds.
- Click → dropdown menu with severity counts (last 24h), snooze status, last 5
  events, and "Open Tripwire TUI…".

Zero third-party deps; links the system `libsqlite3`.
Single binary, wrapped into a < 1 MB `.app` bundle.

## Build

```bash
./scripts/build.sh
```

Output: `dist/Tripwire Menubar.app`.

## Run

```bash
open "dist/Tripwire Menubar.app"
```

The icon appears in your menu bar (top-right). The first read runs immediately;
subsequent reads happen every 5 s. Daemon liveness is derived from the heartbeat
the daemon writes into the store; if it's stale (or the store doesn't exist yet)
the menu shows "daemon not running" / "not set up".

To stop it:

```bash
pkill -f TripwireMenubar
```

(or use the "Quit Tripwire Menubar" menu item)

## Icon states

| Symbol | Meaning |
|---|---|
| `shield` | All quiet (no high+ events in last 24h, no active snooze) |
| `shield.fill` | High-severity events in last 24h |
| `exclamationmark.triangle.fill` | Critical events in last 24h |
| `moon.zzz` | An "all" snooze is active |
| `shield.slash` | Daemon not running (stale heartbeat) / store not set up |

## Data source

The app reads the same SQLite store the daemon writes and the CLI/TUI read
(`~/.tripwire/events.db`), opened read-write so WAL-buffered events are visible
even when the daemon isn't currently holding the DB open. It only ever runs
`SELECT`s. Each refresh computes:

- severity counts over the last 24h (`events`),
- the 5 most recent events,
- the reportable active snooze (`snoozes`, preferring an `all` snooze),
- daemon liveness from the `daemon_heartbeat` row in `meta` (fresh ⇒ up).

"Clear all snoozes" shells out to the `tripwire` CLI so the store keeps a single
writer path. There is no JSON/HTTP contract anymore.

Debug the reader without the GUI:

```bash
.build/release/TripwireMenubar --summary [--db /path/to/events.db]
```

## Notifications

The daemon fires banners by invoking this binary in `--notify` mode, so they
appear under the app's bundle identity (`io.github.jmaleonard.tripwire.menubar`)
as "Tripwire Menubar" rather than "terminal-notifier" / "Script Editor".

## Why not xbar?

xbar uses a 5-15 s polling shell-script model. That's fine for cron-style
status; bad for "tripwire just fired, show it now." This app refreshes at 5 s but
has a real run loop, so we can switch to a file-watch / SSE-style push later
without re-architecting. Also: native menu items, native SF Symbols, no second
app to install.

## Install as a login item (TODO)

The installer (later PR) will copy this `.app` to `~/Applications/` and add a
`LaunchAgent` so it starts on login. For now, drag the `.app` into your
`~/Applications/` manually and System Settings → General → Login Items.
