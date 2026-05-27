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
//! PID attribution:
//!   - Linux/macOS via `notify` crate gives us no PID natively.
//!   - We shell out to `lsof -t -- <path>` per event as a best-effort
//!     correlator. Race-prone for very short open-write-close ops, but
//!     catches longer-held fds (~60-80% of credential reads / writes).
//!   - When lsof returns nothing, pid stays null and the daemon falls
//!     back to a synthetic 'unknown' identity.
//!   - The right long-term answer on macOS is Apple's Endpoint Security
//!     framework (needs a signed app + entitlement); on Linux it's
//!     fanotify (which gives PID natively, replaces this binary there).

use std::io::{self, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
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

    let own_pid = std::process::id();

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
    eprintln!(
        "tripwire-watcher: watching {} path(s); pid resolution via lsof",
        watched
    );

    let stdout = io::stdout();
    let mut out = stdout.lock();

    for res in rx {
        match res {
            Ok(event) => {
                let Some(kind) = map_kind(&event.kind) else { continue };
                for path in &event.paths {
                    let path_str = path.to_string_lossy();
                    let pid = resolve_pid(&path_str, own_pid);
                    let line = serde_json::to_string(&OutEvent {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        path: &path_str,
                        kind,
                        pid,
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

/// Best-effort PID correlation via `lsof -t -- <path>`.
///
/// Returns the first PID that currently has the path open, excluding our own
/// process. Returns `None` when lsof returns nothing or fails.
///
/// Limitations:
/// - Races short-lived open-write-close operations (helper's pipeline can be
///   slower than the syscall pair).
/// - When multiple processes hold the file open, we return the first PID;
///   the daemon's ancestry walker can disambiguate via the process tree.
fn resolve_pid(path: &str, own_pid: u32) -> Option<u32> {
    let output = Command::new("lsof")
        .args(["-t", "--", path])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    String::from_utf8(output.stdout)
        .ok()?
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .find(|&pid| pid != own_pid)
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
