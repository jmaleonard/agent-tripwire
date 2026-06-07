//! Watch setup + event loop. Resolves each configured path (literal or glob),
//! arms a recursive notify watcher, streams events to stdout as JSONL.

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};

use crate::config::Config;
use crate::event::{map_kind, OutEvent};
use crate::pid::resolve_pid;

/// True when `s` contains glob metacharacters and should be expanded via the
/// `glob` crate. Cheap pre-check before we pay for glob's machinery.
pub fn has_glob_chars(s: &str) -> bool {
    s.contains('*') || s.contains('?') || s.contains('[')
}

/// Resolve one config entry to a list of concrete paths to watch.
/// - Literal paths return `[path]` if it exists, `[]` otherwise.
/// - Glob patterns return every matching path that exists right now.
/// Non-existent paths and unmatched globs are logged on stderr.
pub fn resolve_path(spec: &str) -> Vec<PathBuf> {
    if has_glob_chars(spec) {
        match glob::glob(spec) {
            Ok(matches) => {
                let v: Vec<PathBuf> = matches.flatten().collect();
                if v.is_empty() {
                    eprintln!("tripwire-watcher: glob matched nothing: {}", spec);
                }
                v
            }
            Err(e) => {
                eprintln!("tripwire-watcher: invalid glob {}: {}", spec, e);
                Vec::new()
            }
        }
    } else if Path::new(spec).exists() {
        vec![PathBuf::from(spec)]
    } else {
        eprintln!("tripwire-watcher: skipping non-existent path: {}", spec);
        Vec::new()
    }
}

/// Top-level event loop. Arms a recursive watcher on every resolved path
/// from `cfg` and streams JSONL events to stdout until the receiver closes.
/// Returns 0 on clean exit, non-zero when we couldn't even start.
///
/// On Linux we try fanotify first (native PID via the kernel) and fall
/// through to the notify-crate inotify path only when fanotify is
/// unavailable (no CAP_SYS_ADMIN, ancient kernel, etc.).
pub fn run(cfg: &Config) -> i32 {
    #[cfg(target_os = "linux")]
    match crate::linux::try_run(cfg) {
        Ok(rc) => return rc,
        Err(e) => {
            // EPERM (no CAP_SYS_ADMIN), ENOSYS (old kernel), EINVAL: fall back.
            eprintln!(
                "tripwire-watcher: fanotify unavailable ({}), falling back to inotify",
                e
            );
        }
    }

    let (tx, rx) = channel::<Result<Event, notify::Error>>();
    let mut watcher: RecommendedWatcher = match notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    }) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("tripwire-watcher: cannot create watcher: {e}");
            return 1;
        }
    };

    let watched = arm_paths(&mut watcher, cfg);
    eprintln!(
        "tripwire-watcher: watching {} path(s); pid resolution via lsof",
        watched
    );

    let own_pid = std::process::id();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    emit_events(rx, &mut out, own_pid);
    0
}

fn arm_paths(watcher: &mut RecommendedWatcher, cfg: &Config) -> usize {
    let mut watched = 0;
    for spec in cfg.all_paths() {
        for path in resolve_path(spec) {
            match watcher.watch(&path, RecursiveMode::Recursive) {
                Ok(()) => watched += 1,
                Err(e) => {
                    eprintln!(
                        "tripwire-watcher: cannot watch {}: {}",
                        path.display(),
                        e
                    );
                }
            }
        }
    }
    watched
}

fn emit_events(
    rx: Receiver<Result<Event, notify::Error>>,
    out: &mut impl Write,
    own_pid: u32,
) {
    for res in rx {
        match res {
            Ok(event) => {
                let Some(kind) = map_kind(&event.kind) else { continue };
                for path in &event.paths {
                    let path_str = path.to_string_lossy();
                    let pid = resolve_pid(&path_str, own_pid);
                    let out_event = OutEvent {
                        timestamp: chrono::Utc::now().to_rfc3339(),
                        path: &path_str,
                        kind,
                        pid,
                    };
                    if let Ok(line) = serde_json::to_string(&out_event) {
                        let _ = writeln!(out, "{line}");
                        let _ = out.flush();
                    }
                }
            }
            Err(e) => eprintln!("tripwire-watcher: watch error: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_glob_chars() {
        assert!(has_glob_chars("**/*.json"));
        assert!(has_glob_chars("foo?bar"));
        assert!(has_glob_chars("a[bc]d"));
        assert!(!has_glob_chars("/Users/me/.ssh/id_rsa"));
        assert!(!has_glob_chars(""));
    }

    #[test]
    fn resolve_literal_path_that_exists() {
        let tmp = std::env::temp_dir();
        let resolved = resolve_path(tmp.to_str().unwrap());
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0], tmp);
    }

    #[test]
    fn resolve_nonexistent_path() {
        let resolved = resolve_path("/this/definitely/does/not/exist/abc123");
        assert!(resolved.is_empty());
    }

    #[test]
    fn glob_expands_to_concrete_matches() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("tw-glob-test-{}", std::process::id()));
        let nested = base.join(".claude");
        let file = nested.join("settings.json");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&nested).unwrap();
        fs::write(&file, "{}").unwrap();

        let pattern = format!("{}/**/.claude/settings.json", base.display());
        let resolved = resolve_path(&pattern);

        let _ = fs::remove_dir_all(&base);
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0], file);
    }

    #[test]
    fn glob_with_no_matches_returns_empty() {
        let resolved = resolve_path("/tmp/nothing-here-xyz-*/**/settings.json");
        assert!(resolved.is_empty());
    }
}
