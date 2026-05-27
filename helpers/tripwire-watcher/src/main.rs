//! tripwire-watcher: native filesystem watcher helper for tripwired.
//!
//! Protocol:
//!   - Reads a JSON config from stdin (single document, terminated by EOF):
//!       { "read_paths": [...], "write_paths": [...] }
//!   - Watches every path. Existing paths are watched recursively.
//!     Non-existent paths are silently skipped (logged on stderr).
//!   - Emits one JSON object per line on stdout for each filesystem event:
//!       { "timestamp": "ISO-8601", "path": "...", "kind": "read|write|...",
//!         "pid": <int>|null }
//!   - Stderr is for warnings/errors.
//!
//! Backends (via the `notify` crate):
//!   - Linux: inotify (no PID)
//!   - macOS: fsevents (no PID, no reads)
//!   - Windows: ReadDirectoryChangesW (no PID, write-only)
//!
//! PID attribution is null in this MVP — the underlying APIs don't expose it.
//! Linux fanotify (which does expose PID) is a planned follow-up that will
//! replace this binary on Linux.

use std::io::{self, Read, Write};
use std::path::Path;
use std::sync::mpsc::channel;

use notify::event::{AccessKind, EventKind};
use notify::{RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct Config {
    #[serde(default)]
    read_paths: Vec<String>,
    #[serde(default)]
    write_paths: Vec<String>,
}

#[derive(Serialize)]
struct OutEvent<'a> {
    timestamp: String,
    path: &'a str,
    kind: &'a str,
    pid: Option<u32>,
}

fn main() {
    let mut config_str = String::new();
    if let Err(e) = io::stdin().lock().read_to_string(&mut config_str) {
        eprintln!("tripwire-watcher: cannot read config from stdin: {e}");
        std::process::exit(1);
    }
    let config: Config = match serde_json::from_str(&config_str) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("tripwire-watcher: invalid config json: {e}");
            std::process::exit(1);
        }
    };

    let (tx, rx) = channel();
    let mut watcher = match notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("tripwire-watcher: cannot create watcher: {e}");
            std::process::exit(1);
        }
    };

    let mut watched = 0;
    for path in config.read_paths.iter().chain(config.write_paths.iter()) {
        let p = Path::new(path);
        if !p.exists() {
            eprintln!("tripwire-watcher: skipping non-existent path: {}", path);
            continue;
        }
        match watcher.watch(p, RecursiveMode::Recursive) {
            Ok(()) => watched += 1,
            Err(e) => eprintln!("tripwire-watcher: cannot watch {}: {}", path, e),
        }
    }
    eprintln!("tripwire-watcher: watching {} path(s)", watched);

    let stdout = io::stdout();
    let mut out = stdout.lock();

    for res in rx {
        match res {
            Ok(event) => {
                let Some(kind) = map_kind(&event.kind) else { continue };
                for path in &event.paths {
                    let line = serde_json::to_string(&OutEvent {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        path: &path.to_string_lossy(),
                        kind,
                        pid: None,
                    });
                    if let Ok(line) = line {
                        let _ = writeln!(out, "{line}");
                        let _ = out.flush();
                    }
                }
            }
            Err(e) => eprintln!("tripwire-watcher: watch error: {}", e),
        }
    }
}

/// Map `notify`'s rich EventKind enum to our normalized event_kind strings.
/// Returned `None` means "uninteresting" — we drop it.
fn map_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Access(AccessKind::Read) => Some("read"),
        EventKind::Access(AccessKind::Open(_)) => Some("open"),
        EventKind::Access(_) => None,
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(notify::event::ModifyKind::Name(_)) => Some("rename"),
        EventKind::Modify(_) => Some("write"),
        EventKind::Remove(_) => Some("unlink"),
        EventKind::Any | EventKind::Other => None,
    }
}
