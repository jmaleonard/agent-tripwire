//! Output event shape (matches `FsEvent` on the TypeScript side) plus the
//! `notify::EventKind → "read"/"write"/...` mapping.

use notify::event::{AccessKind, EventKind, ModifyKind};
use serde::Serialize;

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
pub struct OutEvent<'a> {
    pub timestamp: String,
    pub path: &'a str,
    pub kind: &'a str,
    pub pid: Option<u32>,
}

/// Map `notify`'s rich EventKind enum to our normalized event_kind strings.
/// `None` means "uninteresting" — drop it.
pub fn map_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Access(AccessKind::Read) => Some("read"),
        EventKind::Access(AccessKind::Open(_)) => Some("open"),
        EventKind::Access(_) => None,
        EventKind::Create(_) => Some("create"),
        EventKind::Modify(ModifyKind::Name(_)) => Some("rename"),
        EventKind::Modify(_) => Some("write"),
        EventKind::Remove(_) => Some("unlink"),
        EventKind::Any | EventKind::Other => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{AccessKind, AccessMode, CreateKind, DataChange, ModifyKind, RemoveKind, RenameMode};

    #[test]
    fn maps_basic_kinds() {
        assert_eq!(map_kind(&EventKind::Access(AccessKind::Read)), Some("read"));
        assert_eq!(
            map_kind(&EventKind::Access(AccessKind::Open(AccessMode::Read))),
            Some("open"),
        );
        assert_eq!(map_kind(&EventKind::Create(CreateKind::File)), Some("create"));
        assert_eq!(
            map_kind(&EventKind::Modify(ModifyKind::Data(DataChange::Content))),
            Some("write"),
        );
        assert_eq!(
            map_kind(&EventKind::Modify(ModifyKind::Name(RenameMode::To))),
            Some("rename"),
        );
        assert_eq!(map_kind(&EventKind::Remove(RemoveKind::File)), Some("unlink"));
    }

    #[test]
    fn drops_uninteresting_kinds() {
        assert!(map_kind(&EventKind::Any).is_none());
        assert!(map_kind(&EventKind::Other).is_none());
        // Access(Close) is uninteresting — close-only events aren't a tell.
        assert!(map_kind(&EventKind::Access(AccessKind::Close(AccessMode::Read))).is_none());
    }

    #[test]
    fn out_event_round_trips_json() {
        let e = OutEvent {
            timestamp: "2026-06-02T12:00:00.000Z".to_string(),
            path: "/a/b",
            kind: "read",
            pid: Some(1234),
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"pid\":1234"));
        assert!(json.contains("\"kind\":\"read\""));
        assert!(json.contains("\"path\":\"/a/b\""));
    }

    #[test]
    fn out_event_pid_null_serializes_as_null() {
        let e = OutEvent {
            timestamp: "x".into(),
            path: "/a",
            kind: "read",
            pid: None,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"pid\":null"));
    }
}
