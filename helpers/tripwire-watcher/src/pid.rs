//! Best-effort PID correlation. Today: shells out to `lsof -t -- <path>` on
//! macOS + Linux. The `notify` crate's underlying APIs (fsevents, inotify)
//! don't expose PID; this is how we get it back.
//!
//! Future: when we swap Linux over to fanotify, we'll wire that backend
//! directly into the kernel's PID-carrying event stream and skip lsof on
//! Linux entirely. The interface here stays the same.

use std::process::{Command, Stdio};

/// Find a PID currently holding `path` open. Returns `None` when nothing has
/// it open, the lsof binary is missing, or parsing fails.
///
/// Excludes our own pid (the watcher process). Returns the first matching pid
/// — the daemon's process-tree walker can disambiguate via ancestry if
/// multiple processes hold the fd.
///
/// Limitations:
/// - Races short open-write-close ops (lsof can't see fds that have already
///   been closed).
/// - Slower than a kernel-native PID source (~50-100 ms on a quiet machine).
pub fn resolve_pid(path: &str, own_pid: u32) -> Option<u32> {
    let output = Command::new("lsof")
        .args(["-t", "--", path])
        .stderr(Stdio::null())
        .output()
        .ok()?;
    parse_lsof_output(&output.stdout, own_pid)
}

fn parse_lsof_output(stdout: &[u8], own_pid: u32) -> Option<u32> {
    std::str::from_utf8(stdout)
        .ok()?
        .lines()
        .filter_map(|l| l.trim().parse::<u32>().ok())
        .find(|&pid| pid != own_pid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_first_non_self_pid() {
        let out = b"100\n200\n300\n";
        assert_eq!(parse_lsof_output(out, 999), Some(100));
        assert_eq!(parse_lsof_output(out, 100), Some(200));
        assert_eq!(parse_lsof_output(out, 200), Some(100));
    }

    #[test]
    fn ignores_garbage_lines() {
        assert_eq!(parse_lsof_output(b"\n\nx\n1234\n", 0), Some(1234));
    }

    #[test]
    fn empty_returns_none() {
        assert!(parse_lsof_output(b"", 0).is_none());
        assert!(parse_lsof_output(b"\n", 0).is_none());
    }

    #[test]
    fn all_self_returns_none() {
        assert!(parse_lsof_output(b"42\n42\n", 42).is_none());
    }

    #[test]
    fn live_resolve_finds_our_own_open_file() {
        use std::fs::File;
        use std::io::Read;

        // Hold a file open in the current process, then ask lsof who has it.
        // resolve_pid filters out own_pid, so we pass a fake own_pid to see
        // that our pid comes back.
        let mut tmp = std::env::temp_dir();
        tmp.push(format!("tripwire-pid-test-{}", std::process::id()));
        std::fs::write(&tmp, b"hello").unwrap();
        let mut f = File::open(&tmp).unwrap();
        let mut sink = [0u8; 5];
        let _ = f.read(&mut sink); // keep the fd open by holding `f`

        let our_pid = std::process::id();
        let pid = resolve_pid(tmp.to_str().unwrap(), 0); // 0 = exclude none
        drop(f);
        let _ = std::fs::remove_file(&tmp);

        // We can't strictly assert pid == our_pid (lsof may not run in CI
        // sandboxes), but if it returns *anything* it should be us.
        if let Some(found) = pid {
            assert_eq!(found, our_pid, "lsof should have found this process");
        }
    }
}
