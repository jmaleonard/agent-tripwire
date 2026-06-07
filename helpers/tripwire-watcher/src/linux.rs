//! Linux fanotify backend.
//!
//! Replaces the lsof-based PID correlation on Linux with the kernel-reported
//! PID that fanotify includes in every event. Requires CAP_SYS_ADMIN (the
//! daemon's user must be root or have the capability set on the binary).
//!
//! When fanotify_init fails — typically EPERM (unprivileged) or ENOSYS
//! (kernel without fanotify) — `try_run` returns the error so the caller
//! can fall back to the cross-platform notify-crate path.
//!
//! Event flow per read():
//!   1. read() the fanotify fd; one read may return several
//!      `fanotify_event_metadata` records back-to-back.
//!   2. Each record carries an fd that points at the actor's view of the
//!      file. We readlink `/proc/self/fd/<fd>` to recover the path, then
//!      close the fd (mandatory — fanotify will exhaust the fd table
//!      otherwise).
//!   3. Decode the mask bitfield into the same wire-kinds as the macOS
//!      path (read / open / write / create / rename / unlink) and emit
//!      an `OutEvent` to stdout.

#![cfg(target_os = "linux")]

use std::ffi::CString;
use std::fs;
use std::io::{self, Read, Write};
use std::mem;
use std::os::fd::{AsRawFd, FromRawFd, IntoRawFd, OwnedFd};
use std::path::{Path, PathBuf};

use libc::{c_int, c_uint};

use crate::config::Config;
use crate::event::OutEvent;
use crate::watcher::resolve_path;

// ── fanotify constants (from <sys/fanotify.h>) ───────────────────────────
//
// libc on stable doesn't expose every fanotify constant uniformly, so we
// define the ones we use here. Values are stable kernel ABI.

const FAN_CLASS_NOTIF: c_uint = 0x0000_0000;
const FAN_CLOEXEC: c_uint = 0x0000_0001;

const FAN_MARK_ADD: c_uint = 0x0000_0001;

// Event masks we register interest in.
const FAN_ACCESS: u64 = 0x0000_0001;
const FAN_MODIFY: u64 = 0x0000_0002;
const FAN_CLOSE_WRITE: u64 = 0x0000_0008;
const FAN_OPEN: u64 = 0x0000_0020;
const FAN_OPEN_EXEC: u64 = 0x0000_4000;
const FAN_CREATE: u64 = 0x0000_0100;
const FAN_DELETE: u64 = 0x0000_0200;
const FAN_MOVED_FROM: u64 = 0x0000_0040;
const FAN_MOVED_TO: u64 = 0x0000_0080;
const FAN_ONDIR: u64 = 0x4000_0000;
const FAN_EVENT_ON_CHILD: u64 = 0x0800_0000;

// fanotify_event_metadata::fd sentinel when no fd is included.
const FAN_NOFD: i32 = -1;

const FANOTIFY_METADATA_VERSION: u8 = 3;

#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct FanotifyEventMetadata {
    event_len: u32,
    vers: u8,
    reserved: u8,
    metadata_len: u16,
    mask: u64,
    fd: i32,
    pid: i32,
}

const METADATA_SIZE: usize = mem::size_of::<FanotifyEventMetadata>();

extern "C" {
    fn fanotify_init(flags: c_uint, event_f_flags: c_uint) -> c_int;
    fn fanotify_mark(
        fanotify_fd: c_int,
        flags: c_uint,
        mask: u64,
        dirfd: c_int,
        pathname: *const libc::c_char,
    ) -> c_int;
}

/// Decode a fanotify mask into the same wire-kind string the macOS path
/// uses. Returns the highest-priority kind we recognize, or `None` for
/// masks we don't care about.
fn mask_to_kind(mask: u64) -> Option<&'static str> {
    // Order matters: a single event can carry multiple bits (e.g.
    // FAN_OPEN|FAN_OPEN_EXEC), and we pick the most specific one.
    if mask & (FAN_DELETE) != 0 {
        Some("unlink")
    } else if mask & (FAN_MOVED_FROM | FAN_MOVED_TO) != 0 {
        Some("rename")
    } else if mask & FAN_CREATE != 0 {
        Some("create")
    } else if mask & (FAN_MODIFY | FAN_CLOSE_WRITE) != 0 {
        Some("write")
    } else if mask & FAN_OPEN_EXEC != 0 {
        Some("open")
    } else if mask & FAN_OPEN != 0 {
        Some("open")
    } else if mask & FAN_ACCESS != 0 {
        Some("read")
    } else {
        None
    }
}

/// Resolve a fanotify-supplied fd back to the path the actor opened it
/// at. Closes the fd after reading.
fn fd_to_path(fd: i32) -> io::Result<PathBuf> {
    // SAFETY: the kernel handed us this fd; we own it from here.
    let owned = unsafe { OwnedFd::from_raw_fd(fd) };
    let link = format!("/proc/self/fd/{}", owned.as_raw_fd());
    fs::read_link(&link)
}

/// Try to start a fanotify session. Returns `Err` on the kernel/permission
/// errors that should trigger fallback (EPERM, ENOSYS, EINVAL); other
/// errors are unexpected and also returned.
pub fn try_run(cfg: &Config) -> io::Result<i32> {
    let fan_fd = unsafe {
        fanotify_init(
            FAN_CLASS_NOTIF | FAN_CLOEXEC,
            (libc::O_RDONLY | libc::O_LARGEFILE | libc::O_CLOEXEC) as c_uint,
        )
    };
    if fan_fd < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: we just got this fd from fanotify_init.
    let fan_fd = unsafe { OwnedFd::from_raw_fd(fan_fd) };

    let mark_mask: u64 = FAN_ACCESS
        | FAN_MODIFY
        | FAN_CLOSE_WRITE
        | FAN_OPEN
        | FAN_OPEN_EXEC
        | FAN_CREATE
        | FAN_DELETE
        | FAN_MOVED_FROM
        | FAN_MOVED_TO
        | FAN_ONDIR
        | FAN_EVENT_ON_CHILD;

    let mut marked = 0usize;
    for spec in cfg.all_paths() {
        for path in resolve_path(spec) {
            match mark_path(fan_fd.as_raw_fd(), &path, mark_mask) {
                Ok(()) => marked += 1,
                Err(e) => eprintln!(
                    "tripwire-watcher: fanotify_mark {} failed: {}",
                    path.display(),
                    e
                ),
            }
        }
    }
    eprintln!(
        "tripwire-watcher: fanotify watching {} path(s); pid via kernel",
        marked
    );

    let own_pid = std::process::id();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    event_loop(fan_fd, &mut out, own_pid)?;
    Ok(0)
}

fn mark_path(fan_fd: c_int, path: &Path, mask: u64) -> io::Result<()> {
    let c_path = CString::new(path.as_os_str().to_string_lossy().into_owned())
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
    let rc = unsafe {
        fanotify_mark(
            fan_fd,
            FAN_MARK_ADD,
            mask,
            libc::AT_FDCWD,
            c_path.as_ptr(),
        )
    };
    if rc < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn event_loop(fan_fd: OwnedFd, out: &mut impl Write, own_pid: u32) -> io::Result<()> {
    // SAFETY: we converted from a kernel-supplied fd; reading is safe and
    // wrapping in a File lets us use the std::io::Read interface.
    let mut file = unsafe { fs::File::from_raw_fd(fan_fd.into_raw_fd()) };
    let mut buf = [0u8; 4096];
    loop {
        let n = match file.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        for evt in parse_events(&buf[..n]) {
            if evt.pid == own_pid as i32 {
                continue; // ignore events we caused ourselves
            }
            let kind = match mask_to_kind(evt.mask) {
                Some(k) => k,
                None => {
                    if evt.fd >= 0 {
                        unsafe { libc::close(evt.fd) };
                    }
                    continue;
                }
            };
            let path = if evt.fd == FAN_NOFD {
                None
            } else {
                match fd_to_path(evt.fd) {
                    Ok(p) => Some(p),
                    Err(_) => None,
                }
            };
            // fd_to_path drops the OwnedFd, which closes it; but if we
            // bailed out on err before that conversion, we'd still have
            // an open fd. The path-resolution branch above guarantees fd
            // is consumed either way.

            let path_buf = path.unwrap_or_else(|| PathBuf::from("<unknown>"));
            let path_str = path_buf.to_string_lossy();
            let out_event = OutEvent {
                timestamp: chrono::Utc::now().to_rfc3339(),
                path: &path_str,
                kind,
                pid: Some(evt.pid as u32),
            };
            if let Ok(line) = serde_json::to_string(&out_event) {
                let _ = writeln!(out, "{line}");
                let _ = out.flush();
            }
        }
    }
    Ok(())
}

/// Walk a fanotify read() buffer, yielding one record per event. Skips
/// records with a malformed length so a single bad record doesn't crash
/// the loop.
fn parse_events(buf: &[u8]) -> Vec<FanotifyEventMetadata> {
    let mut events = Vec::new();
    let mut offset = 0usize;
    while offset + METADATA_SIZE <= buf.len() {
        // SAFETY: we just bounds-checked that METADATA_SIZE bytes are
        // available; FanotifyEventMetadata is a POD #[repr(C)] type.
        let meta: FanotifyEventMetadata =
            unsafe { std::ptr::read_unaligned(buf.as_ptr().add(offset) as *const _) };
        if meta.vers != FANOTIFY_METADATA_VERSION {
            // Kernel/userspace ABI mismatch — bail rather than read garbage.
            break;
        }
        let len = meta.event_len as usize;
        if len < METADATA_SIZE || offset + len > buf.len() {
            break;
        }
        events.push(meta);
        offset += len;
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(mask: u64, pid: i32, fd: i32) -> FanotifyEventMetadata {
        FanotifyEventMetadata {
            event_len: METADATA_SIZE as u32,
            vers: FANOTIFY_METADATA_VERSION,
            reserved: 0,
            metadata_len: METADATA_SIZE as u16,
            mask,
            fd,
            pid,
        }
    }

    fn encode(records: &[FanotifyEventMetadata]) -> Vec<u8> {
        let mut buf = Vec::with_capacity(records.len() * METADATA_SIZE);
        for r in records {
            let bytes: [u8; METADATA_SIZE] =
                unsafe { std::mem::transmute_copy(r) };
            buf.extend_from_slice(&bytes);
        }
        buf
    }

    #[test]
    fn mask_decodes_to_expected_kinds() {
        assert_eq!(mask_to_kind(FAN_ACCESS), Some("read"));
        assert_eq!(mask_to_kind(FAN_OPEN), Some("open"));
        assert_eq!(mask_to_kind(FAN_OPEN_EXEC), Some("open"));
        assert_eq!(mask_to_kind(FAN_MODIFY), Some("write"));
        assert_eq!(mask_to_kind(FAN_CLOSE_WRITE), Some("write"));
        assert_eq!(mask_to_kind(FAN_CREATE), Some("create"));
        assert_eq!(mask_to_kind(FAN_DELETE), Some("unlink"));
        assert_eq!(mask_to_kind(FAN_MOVED_FROM), Some("rename"));
        assert_eq!(mask_to_kind(FAN_MOVED_TO), Some("rename"));
    }

    #[test]
    fn mask_zero_returns_none() {
        assert_eq!(mask_to_kind(0), None);
    }

    #[test]
    fn create_outranks_modify_when_both_set() {
        // A new file may carry FAN_CREATE|FAN_MODIFY|FAN_OPEN — we want
        // 'create' to win because it's the most informative.
        assert_eq!(
            mask_to_kind(FAN_CREATE | FAN_MODIFY | FAN_OPEN),
            Some("create")
        );
    }

    #[test]
    fn parse_events_handles_empty_buffer() {
        assert!(parse_events(&[]).is_empty());
    }

    #[test]
    fn parse_events_reads_one_record() {
        let buf = encode(&[meta(FAN_OPEN, 1234, FAN_NOFD)]);
        let evts = parse_events(&buf);
        assert_eq!(evts.len(), 1);
        assert_eq!(evts[0].pid, 1234);
        assert_eq!(evts[0].mask, FAN_OPEN);
    }

    #[test]
    fn parse_events_reads_multiple_packed_records() {
        let buf = encode(&[
            meta(FAN_OPEN, 1, FAN_NOFD),
            meta(FAN_MODIFY, 2, FAN_NOFD),
            meta(FAN_CLOSE_WRITE, 3, FAN_NOFD),
        ]);
        let evts = parse_events(&buf);
        assert_eq!(evts.len(), 3);
        assert_eq!(evts[0].pid, 1);
        assert_eq!(evts[1].pid, 2);
        assert_eq!(evts[2].pid, 3);
    }

    #[test]
    fn parse_events_stops_on_bad_version() {
        let mut bad = meta(FAN_OPEN, 1, FAN_NOFD);
        bad.vers = 99;
        let buf = encode(&[bad]);
        assert!(parse_events(&buf).is_empty());
    }

    #[test]
    fn parse_events_stops_on_truncated_tail() {
        let mut buf = encode(&[meta(FAN_OPEN, 1, FAN_NOFD)]);
        // Append a truncated half-record.
        buf.extend_from_slice(&[0u8; METADATA_SIZE / 2]);
        let evts = parse_events(&buf);
        assert_eq!(evts.len(), 1);
    }

    #[test]
    fn parse_events_stops_on_bogus_event_len() {
        let mut bad = meta(FAN_OPEN, 1, FAN_NOFD);
        bad.event_len = 4; // less than metadata size
        let buf = encode(&[bad]);
        assert!(parse_events(&buf).is_empty());
    }
}
