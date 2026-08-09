use std::fs::{File, OpenOptions};
use std::path::Path;
use std::sync::Mutex;

use tracing_subscriber::EnvFilter;
use tracing_subscriber::filter::LevelFilter;

const HOOK_LOG_FILE: &str = "hook.log";
/// Rewritten from the start once it reaches this size. The hook is the one
/// writer that must never be able to fill the disk it shares with the
/// repositories, and a bounded log needs no rotation to manage.
const HOOK_LOG_LIMIT_BYTES: u64 = 8 * 1024 * 1024;

/// Sends the hook's diagnostics to a file the operator owns. Its stderr belongs
/// to receive-pack, which relays every line to whoever pushed as `remote:`
/// output, so warnings about spooling and ancestry must never go there.
///
/// Best effort throughout: a hook that cannot open its log still reports the
/// push, and still exits successfully.
pub fn initialize_hook_logging(spool_path: &Path) {
    let Some(log) = open_hook_log(spool_path) else {
        return;
    };

    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::builder()
                .with_default_directive(LevelFilter::WARN.into())
                .from_env_lossy(),
        )
        .with_ansi(false)
        .with_writer(Mutex::new(log))
        .try_init();
}

fn open_hook_log(spool_path: &Path) -> Option<File> {
    std::fs::create_dir_all(spool_path).ok()?;

    let log_path = spool_path.join(HOOK_LOG_FILE);
    let is_full =
        std::fs::metadata(&log_path).is_ok_and(|metadata| metadata.len() >= HOOK_LOG_LIMIT_BYTES);

    OpenOptions::new()
        .create(true)
        .write(true)
        .append(!is_full)
        .truncate(is_full)
        .open(&log_path)
        .ok()
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[test]
    fn appends_to_a_log_under_the_spool() {
        let temp_dir = TempDir::new().unwrap();
        let spool_path = temp_dir.path().join("push-events");

        std::fs::write(spool_path.join("ignored"), b"").ok();
        let first = open_hook_log(&spool_path).unwrap();
        drop(first);
        std::fs::write(spool_path.join(HOOK_LOG_FILE), b"previous run\n").unwrap();
        open_hook_log(&spool_path).unwrap();

        let log = std::fs::read_to_string(spool_path.join(HOOK_LOG_FILE)).unwrap();
        assert_eq!(log, "previous run\n");
    }

    #[test]
    fn rewrites_the_log_once_it_reaches_its_limit() {
        let temp_dir = TempDir::new().unwrap();
        let spool_path = temp_dir.path().to_path_buf();
        std::fs::write(
            spool_path.join(HOOK_LOG_FILE),
            vec![b'x'; HOOK_LOG_LIMIT_BYTES as usize],
        )
        .unwrap();

        open_hook_log(&spool_path).unwrap();

        let log = std::fs::metadata(spool_path.join(HOOK_LOG_FILE)).unwrap();
        assert_eq!(log.len(), 0);
    }

    #[test]
    fn survives_a_spool_it_cannot_create() {
        let temp_dir = TempDir::new().unwrap();
        let blocked = temp_dir.path().join("blocked");
        std::fs::write(&blocked, b"not a directory").unwrap();

        assert!(open_hook_log(&blocked).is_none());
    }
}
