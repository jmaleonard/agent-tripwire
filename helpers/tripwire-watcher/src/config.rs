//! Stdin-fed JSON config that tells the watcher which paths to watch.
//!
//! Format:
//!   { "read_paths": [...], "write_paths": [...] }
//!
//! Both arrays may contain literal paths (`~/.ssh`, already tilde-expanded by
//! the daemon) and glob patterns (`**/.claude/settings.json`,
//! `~/Library/Application Support/Google/Chrome/*/Cookies`). The watcher
//! decides per-entry which it is.

use std::io::{self, Read};
use serde::Deserialize;

#[derive(Debug, Default, Clone, Deserialize, PartialEq, Eq)]
pub struct Config {
    #[serde(default)]
    pub read_paths: Vec<String>,
    #[serde(default)]
    pub write_paths: Vec<String>,
}

impl Config {
    /// Read a JSON document from stdin and parse. Errors are bubbled to the
    /// caller so main() can decide exit code + stderr message.
    pub fn from_stdin() -> Result<Self, ConfigError> {
        let mut buf = String::new();
        io::stdin()
            .lock()
            .read_to_string(&mut buf)
            .map_err(ConfigError::Io)?;
        Self::from_json(&buf)
    }

    pub fn from_json(s: &str) -> Result<Self, ConfigError> {
        serde_json::from_str(s).map_err(ConfigError::Parse)
    }

    /// Both lists, in a single iterator. Watching order doesn't matter.
    pub fn all_paths(&self) -> impl Iterator<Item = &String> {
        self.read_paths.iter().chain(self.write_paths.iter())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("reading stdin: {0}")]
    Io(io::Error),
    #[error("invalid JSON: {0}")]
    Parse(serde_json::Error),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_object_yields_empty_lists() {
        let c = Config::from_json("{}").unwrap();
        assert!(c.read_paths.is_empty());
        assert!(c.write_paths.is_empty());
    }

    #[test]
    fn both_fields_populated() {
        let c = Config::from_json(
            r#"{"read_paths":["/a","/b"],"write_paths":["/c"]}"#,
        )
        .unwrap();
        assert_eq!(c.read_paths, vec!["/a", "/b"]);
        assert_eq!(c.write_paths, vec!["/c"]);
    }

    #[test]
    fn only_one_field_set() {
        let c = Config::from_json(r#"{"read_paths":["/x"]}"#).unwrap();
        assert_eq!(c.read_paths, vec!["/x"]);
        assert!(c.write_paths.is_empty());
    }

    #[test]
    fn rejects_garbage() {
        let err = Config::from_json("not json").unwrap_err();
        match err {
            ConfigError::Parse(_) => {}
            _ => panic!("expected Parse error, got {err:?}"),
        }
    }

    #[test]
    fn all_paths_chains_reads_then_writes() {
        let c = Config {
            read_paths: vec!["a".into(), "b".into()],
            write_paths: vec!["c".into()],
        };
        let all: Vec<&String> = c.all_paths().collect();
        assert_eq!(all, vec![&"a".to_string(), &"b".to_string(), &"c".to_string()]);
    }
}
