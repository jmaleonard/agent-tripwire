//! tripwire-watcher: native filesystem watcher helper for tripwired.
//!
//! Reads a JSON config from stdin (`{ "read_paths": [...], "write_paths": [...] }`),
//! arms a recursive watcher on every resolved path, and emits one JSON line
//! per event on stdout:
//!
//!   { "timestamp": "ISO-8601", "path": "...", "kind": "read|write|...",
//!     "pid": <int>|null }
//!
//! See module docs for details:
//! - `config`  — stdin parser
//! - `event`   — output shape + EventKind mapping
//! - `watcher` — path resolution (literal + glob) + event loop
//! - `pid`     — best-effort PID correlation (currently lsof on macOS/Linux)
//!
//! Backends (via the `notify` crate, transitional):
//!   - Linux: inotify (no native PID)
//!   - macOS: fsevents (no native PID, write-only)
//!   - Windows: ReadDirectoryChangesW
//!
//! Linux fanotify (kernel-reported PID, more event kinds) replaces the Linux
//! backend in a planned follow-up; the JSON-over-stdout protocol stays the
//! same so the daemon doesn't need changes.

mod config;
mod event;
mod pid;
mod watcher;

use config::Config;

fn main() {
    let cfg = match Config::from_stdin() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("tripwire-watcher: {e}");
            std::process::exit(1);
        }
    };
    std::process::exit(watcher::run(&cfg));
}
