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
//! Backends:
//!   - Linux: fanotify (kernel-reported PID); falls back to inotify via
//!     the `notify` crate if fanotify_init fails (no CAP_SYS_ADMIN, etc.).
//!   - macOS: fsevents via `notify`, PID via `lsof` correlation.
//!   - Windows: ReadDirectoryChangesW via `notify`.

mod config;
mod event;
#[cfg(target_os = "linux")]
mod linux;
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
