# tripwire-watcher

Native filesystem watcher helper for `tripwired`. Sits in front of the kernel,
streams events as JSONL on stdout.

## Build

```bash
cargo build --release
# Binary at: target/release/tripwire-watcher
```

## Protocol

Stdin (single JSON document):

```json
{
  "read_paths":  ["/Users/me/.aws", "/Users/me/.ssh"],
  "write_paths": ["/Users/me/.bashrc"]
}
```

Stdout (one event per line):

```jsonl
{"timestamp":"2026-05-27T13:45:01Z","path":"/Users/me/.aws/credentials","kind":"read","pid":null}
{"timestamp":"2026-05-27T13:45:02Z","path":"/Users/me/.bashrc","kind":"write","pid":null}
```

Stderr is for warnings (non-existent paths, watch failures).

## Backends (v0.1)

| Platform | Backend | PID? | Reads? |
|---|---|---|---|
| Linux | inotify (via `notify` crate) | no | yes |
| macOS | fsevents (via `notify` crate) | no | no (write-only) |

PID attribution is `null` in this MVP — the underlying APIs don't expose it.
A planned follow-up swaps Linux over to **fanotify** (which does expose PID,
plus more event kinds) and adds an Endpoint Security path for macOS reads.

For now the daemon synthesizes an "unknown" identity for PID-null events;
rules with `applies_to.ancestry_category.not_in: ["human-shell"]` still fire.

## Why a separate binary

- Node can't reach the kernel watch APIs (fanotify, fsevents) directly.
- A native helper isolates the OS-specific code from the TypeScript daemon.
- The same JSON protocol works whether the helper is this `notify`-based MVP
  or a future fanotify-based replacement — daemon code doesn't change.
