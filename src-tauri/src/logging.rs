use std::fs::{self, File, OpenOptions};
use std::path::Path;

use tracing_subscriber::fmt::writer::MakeWriterExt;
use tracing_subscriber::EnvFilter;

/// Dev log, relative to the process working directory. Gitignored.
pub const DEV_LOG: &str = "logs/fiore-dev.log";

#[derive(Debug, thiserror::Error)]
pub enum LoggingError {
    #[error("logging init failed: {0}")]
    Init(String),
}

/// JSON lines to `logs/fiore-dev.log`, plus stderr so `tauri dev` still shows them.
/// `RUST_LOG` selects the filter; when it is unset the filter is `info`, so
/// debug-only fields (window titles, track names) stay off unless asked for.
pub fn init() -> Result<(), LoggingError> {
    let raw = std::env::var("RUST_LOG").ok();
    let filter = parse_filter(raw.as_deref())?;
    let file = open_log(Path::new(DEV_LOG))?;
    let subscriber = build_subscriber(filter, file.and(std::io::stderr));
    tracing::subscriber::set_global_default(subscriber)
        .map_err(|err| LoggingError::Init(err.to_string()))
}

fn parse_filter(raw: Option<&str>) -> Result<EnvFilter, LoggingError> {
    let directive = match raw.map(str::trim) {
        None | Some("") => "info",
        Some(value) => value,
    };
    EnvFilter::try_new(directive).map_err(|err| LoggingError::Init(format!("RUST_LOG: {err}")))
}

fn open_log(path: &Path) -> Result<File, LoggingError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| LoggingError::Init(err.to_string()))?;
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|err| LoggingError::Init(err.to_string()))
}

fn build_subscriber<W>(
    filter: EnvFilter,
    writer: W,
) -> impl tracing::Subscriber + Send + Sync + 'static
where
    W: for<'a> tracing_subscriber::fmt::MakeWriter<'a> + Send + Sync + 'static,
{
    tracing_subscriber::fmt()
        .json()
        .with_ansi(false)
        .with_env_filter(filter)
        .with_writer(writer)
        .finish()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    struct Scratch(PathBuf);

    impl Scratch {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let n = NEXT.fetch_add(1, Ordering::Relaxed);
            Self(std::env::temp_dir().join(format!("fiore-log-{}-{n}", std::process::id())))
        }

        fn log_path(&self) -> PathBuf {
            self.0.join("fiore-dev.log")
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn capture(filter: &str, scratch: &Scratch, emit: impl Fn()) -> String {
        let path = scratch.log_path();
        let file = open_log(&path).unwrap();
        let subscriber =
            build_subscriber(parse_filter(Some(filter)).unwrap(), file.and(std::io::sink));
        tracing::subscriber::with_default(subscriber, emit);
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn json_line_respects_rust_log_filter() {
        let scratch = Scratch::new();
        let info = capture("info", &scratch, || {
            tracing::debug!(sensor = "clock", "hidden");
            tracing::info!(sensor = "clock", "visible");
        });
        assert!(info.contains("\"level\":\"INFO\""), "{info}");
        assert!(info.contains("visible"), "{info}");
        assert!(!info.contains("hidden"), "{info}");

        let debug = capture("debug", &scratch, || {
            tracing::debug!(sensor = "clock", "hidden");
        });
        assert!(debug.contains("\"level\":\"DEBUG\""), "{debug}");
        assert!(debug.contains("hidden"), "{debug}");
    }

    #[test]
    fn rejects_invalid_rust_log() {
        let err = parse_filter(Some("=")).unwrap_err();
        assert!(err.to_string().contains("RUST_LOG"));
    }

    #[test]
    fn empty_rust_log_defaults_to_info() {
        let filter = parse_filter(None).unwrap();
        assert_eq!(filter.to_string(), "info");
        let filter = parse_filter(Some("  ")).unwrap();
        assert_eq!(filter.to_string(), "info");
    }

    #[test]
    fn dev_log_path_is_the_gitignored_file() {
        assert_eq!(DEV_LOG, "logs/fiore-dev.log");
    }
}
