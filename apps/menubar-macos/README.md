# Tripwire Menubar (macOS)

A tiny native macOS menu-bar app that mirrors the daemon's state.

- `LSUIElement = true` — no Dock icon, no main window.
- One `NSStatusItem` with severity-aware SF Symbol.
- Polls `http://localhost:7878/api/summary` every 5 seconds.
- Click → dropdown menu with severity counts (last 24h), snooze status, last 5 events, and "Open dashboard…".

Zero native deps beyond the system (`AppKit`, `Foundation`).
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

The icon appears in your menu bar (top-right). The first poll runs immediately; subsequent polls happen every 5 s. Until the daemon's dashboard server lands, the menu shows "Daemon not running."

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
| `shield.slash` | Daemon not running / unreachable |

## API contract (consumed)

The app expects the daemon to expose:

```
GET /api/summary
Response 200:
{
  "counts": {"critical": 0, "high": 2, "medium": 0, "low": 5, "info": 12},
  "recent": [
    {
      "event_id": "evt-…",
      "timestamp": "2026-05-26T12:00:00Z",
      "severity": "high",
      "rule_id": "cred.aws-credentials-read",
      "rule_name": "AWS credentials file read",
      "ancestry_category": "agent-subprocess"
    }
  ],
  "snoozes": {
    "active": true,
    "kind": "all",
    "expires_at": "2026-05-26T13:00:00Z"
  }
}

DELETE /api/snoozes
Response 200/204
```

Other failure modes (connection refused, 5xx, decode failures) all collapse to the "daemon down" state in the UI.

## Why not xbar?

xbar uses a 5-15 s polling shell-script model. That's fine for cron-style status; bad for "tripwire just fired, show it now." This app polls the same way at 5 s but has a real run loop, so we can switch to SSE later for instant updates without re-architecting. Also: native menu items, native SF Symbols, no second app to install.

## Install as a login item (TODO)

The installer (later PR) will copy this `.app` to `~/Applications/` and add a `LaunchAgent` so it starts on login. For now, drag the `.app` into your `~/Applications/` manually and System Settings → General → Login Items.
