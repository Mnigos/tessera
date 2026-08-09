use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use prost::Message;
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::proto::NotifyPushRequest;
use crate::push_events::domain::PushEventError;

const SPOOLED_EXTENSION: &str = "push";
const PENDING_EXTENSION: &str = "pending";
const SET_ASIDE_EXTENSION: &str = "invalid";

/// How many undelivered pushes the spool holds before it refuses new ones. The
/// spool shares a filesystem with the repositories, and losing a reported event
/// is recoverable where losing room for Git objects is not.
pub const DEFAULT_SPOOL_CAPACITY: usize = 10_000;
const SET_ASIDE_CAPACITY: usize = 1_000;
/// A `.pending` file younger than this may still be mid-write by a hook that is
/// running right now, so recovery leaves it alone.
const PENDING_RECOVERY_AGE: Duration = Duration::from_secs(60);

/// Pushes that the API has not acknowledged yet, on the same disk as the
/// repositories they describe. A push is durable here before the hook lets
/// receive-pack finish, so a notification the API never received is still
/// deliverable after a restart.
#[derive(Clone, Debug)]
pub struct PushEventSpool {
    directory: PathBuf,
    capacity: usize,
}

impl PushEventSpool {
    pub fn new(directory: PathBuf) -> Self {
        Self::with_capacity(directory, DEFAULT_SPOOL_CAPACITY)
    }

    pub fn with_capacity(directory: PathBuf, capacity: usize) -> Self {
        Self {
            directory,
            capacity,
        }
    }

    /// Writes the notification under a temporary name, syncs it and the
    /// directory entry, and renames it into place, so a sweep never reads a
    /// half-written delivery and a restart never loses a whole one.
    pub async fn store(&self, request: &NotifyPushRequest) -> Result<PathBuf, PushEventError> {
        fs::create_dir_all(&self.directory)
            .await
            .map_err(PushEventError::SpoolIo)?;

        let undelivered = self.count(&[SPOOLED_EXTENSION, PENDING_EXTENSION]).await?;

        if undelivered >= self.capacity {
            tracing::error!(
                undelivered,
                capacity = self.capacity,
                operation_id = %request.operation_id,
                "push will not be reported: the spool is full"
            );

            return Err(PushEventError::SpoolFull);
        }

        let pending_path = self
            .directory
            .join(format!("{}.{PENDING_EXTENSION}", request.operation_id));
        let spooled_path = self
            .directory
            .join(format!("{}.{SPOOLED_EXTENSION}", request.operation_id));
        let file = fs::File::create(&pending_path)
            .await
            .map_err(PushEventError::SpoolIo)?;

        write_and_sync(file, request.encode_to_vec()).await?;
        fs::rename(&pending_path, &spooled_path)
            .await
            .map_err(PushEventError::SpoolIo)?;
        self.sync_directory().await?;

        Ok(spooled_path)
    }

    pub async fn pending(&self) -> Result<Vec<PathBuf>, PushEventError> {
        let mut paths = self.paths_with_extension(SPOOLED_EXTENSION).await?;
        paths.sort();

        Ok(paths)
    }

    /// Promotes deliveries whose rename never happened. A hook killed between
    /// the sync and the rename leaves a complete `.pending` file behind, which
    /// no sweep would otherwise look at again.
    pub async fn recover_pending(&self) {
        let Ok(paths) = self.paths_with_extension(PENDING_EXTENSION).await else {
            return;
        };

        for path in paths {
            if !is_older_than(&path, PENDING_RECOVERY_AGE).await {
                continue;
            }

            match self.load(&path).await {
                Ok(_) => self.promote(&path).await,
                Err(_) => self.set_aside(&path).await,
            }
        }
    }

    pub async fn load(&self, path: &Path) -> Result<NotifyPushRequest, PushEventError> {
        let contents = fs::read(path).await.map_err(PushEventError::SpoolIo)?;

        NotifyPushRequest::decode(contents.as_slice()).map_err(|_| PushEventError::InvalidSpoolFile)
    }

    pub async fn remove(&self, path: &Path) {
        if let Err(error) = fs::remove_file(path).await {
            tracing::warn!(
                path = %path.display(),
                error = %error,
                "acknowledged push could not be removed from the spool"
            );
        }
    }

    /// Keeps an undeliverable push out of every later sweep without discarding
    /// the evidence of what could not be delivered — until keeping that
    /// evidence would itself grow without bound.
    pub async fn set_aside(&self, path: &Path) {
        if self
            .count(&[SET_ASIDE_EXTENSION])
            .await
            .is_ok_and(|set_aside| set_aside >= SET_ASIDE_CAPACITY)
        {
            tracing::warn!(
                path = %path.display(),
                "undeliverable push was discarded: too many are already set aside"
            );
            self.remove(path).await;

            return;
        }

        let set_aside_path = path.with_extension(SET_ASIDE_EXTENSION);

        match fs::rename(path, &set_aside_path).await {
            Ok(()) => tracing::warn!(
                path = %set_aside_path.display(),
                "undeliverable push was set aside"
            ),
            Err(error) => tracing::warn!(
                path = %path.display(),
                error = %error,
                "undeliverable push could not be set aside"
            ),
        }
    }

    async fn promote(&self, path: &Path) {
        let spooled_path = path.with_extension(SPOOLED_EXTENSION);

        match fs::rename(path, &spooled_path).await {
            Ok(()) => {
                let _ = self.sync_directory().await;
                tracing::warn!(
                    path = %spooled_path.display(),
                    "push that was never handed over was recovered from the spool"
                );
            }
            Err(error) => tracing::warn!(
                path = %path.display(),
                error = %error,
                "unhanded push could not be recovered"
            ),
        }
    }

    async fn paths_with_extension(&self, extension: &str) -> Result<Vec<PathBuf>, PushEventError> {
        let mut entries = match fs::read_dir(&self.directory).await {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(PushEventError::SpoolIo(error)),
        };
        let mut paths = Vec::new();

        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(PushEventError::SpoolIo)?
        {
            let path = entry.path();

            if path.extension().is_some_and(|found| found == extension) {
                paths.push(path);
            }
        }

        Ok(paths)
    }

    async fn count(&self, extensions: &[&str]) -> Result<usize, PushEventError> {
        let mut counted = 0;

        for extension in extensions {
            counted += self.paths_with_extension(extension).await?.len();
        }

        Ok(counted)
    }

    /// A rename is only durable once the directory entry itself is.
    async fn sync_directory(&self) -> Result<(), PushEventError> {
        fs::File::open(&self.directory)
            .await
            .map_err(PushEventError::SpoolIo)?
            .sync_all()
            .await
            .map_err(PushEventError::SpoolIo)
    }
}

async fn write_and_sync(mut file: fs::File, contents: Vec<u8>) -> Result<(), PushEventError> {
    file.write_all(&contents)
        .await
        .map_err(PushEventError::SpoolIo)?;
    file.sync_all().await.map_err(PushEventError::SpoolIo)?;

    Ok(())
}

async fn is_older_than(path: &Path, age: Duration) -> bool {
    let Ok(metadata) = fs::metadata(path).await else {
        return false;
    };
    let Ok(modified) = metadata.modified() else {
        return false;
    };

    SystemTime::now()
        .duration_since(modified)
        .is_ok_and(|elapsed| elapsed >= age)
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn request(operation_id: &str) -> NotifyPushRequest {
        NotifyPushRequest {
            operation_id: operation_id.to_string(),
            repository_id: "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5".to_string(),
            actor_user_id: "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b6".to_string(),
            occurred_at_unix_ms: 1_700_000_000_000,
            updates: Vec::new(),
        }
    }

    #[tokio::test]
    async fn stores_and_reloads_a_push() {
        let temp_dir = TempDir::new().unwrap();
        let spool = PushEventSpool::new(temp_dir.path().join("push-events"));

        let path = spool.store(&request("operation")).await.unwrap();
        let pending = spool.pending().await.unwrap();
        let loaded = spool.load(&path).await.unwrap();

        assert_eq!(pending, vec![path]);
        assert_eq!(loaded, request("operation"));
    }

    #[tokio::test]
    async fn reports_no_pending_pushes_before_the_spool_exists() {
        let temp_dir = TempDir::new().unwrap();
        let spool = PushEventSpool::new(temp_dir.path().join("push-events"));

        assert!(spool.pending().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn removes_and_sets_aside_spooled_pushes() {
        let temp_dir = TempDir::new().unwrap();
        let spool = PushEventSpool::new(temp_dir.path().to_path_buf());
        let removed = spool.store(&request("removed")).await.unwrap();
        let set_aside = spool.store(&request("set-aside")).await.unwrap();

        spool.remove(&removed).await;
        spool.set_aside(&set_aside).await;

        assert!(spool.pending().await.unwrap().is_empty());
        assert!(set_aside.with_extension("invalid").exists());
    }

    #[tokio::test]
    async fn refuses_to_load_a_corrupted_push() {
        let temp_dir = TempDir::new().unwrap();
        let spool = PushEventSpool::new(temp_dir.path().to_path_buf());
        let path = spool.store(&request("corrupted")).await.unwrap();
        fs::write(&path, b"not a protobuf message").await.unwrap();

        let error = spool.load(&path).await.unwrap_err();

        assert!(matches!(error, PushEventError::InvalidSpoolFile));
    }

    #[tokio::test]
    async fn refuses_to_spool_beyond_its_capacity() {
        let temp_dir = TempDir::new().unwrap();
        let spool = PushEventSpool::with_capacity(temp_dir.path().to_path_buf(), 1);
        spool.store(&request("first")).await.unwrap();

        let error = spool.store(&request("second")).await.unwrap_err();

        assert!(matches!(error, PushEventError::SpoolFull));
        assert_eq!(spool.pending().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn discards_undeliverable_pushes_once_too_many_are_set_aside() {
        let temp_dir = TempDir::new().unwrap();
        let spool = PushEventSpool::new(temp_dir.path().to_path_buf());

        for index in 0..SET_ASIDE_CAPACITY {
            fs::write(temp_dir.path().join(format!("{index}.invalid")), b"")
                .await
                .unwrap();
        }
        let path = spool.store(&request("discarded")).await.unwrap();
        spool.set_aside(&path).await;

        assert!(!path.exists());
        assert!(!path.with_extension("invalid").exists());
    }
}
