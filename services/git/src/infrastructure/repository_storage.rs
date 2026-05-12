use std::env;
use std::path::{Component, Path, PathBuf};

use tokio::fs;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{RepositoryCreated, RepositoryError, RepositoryId};

#[derive(Clone, Debug)]
pub struct RepositoryStorage {
    storage_root: PathBuf,
    git_binary: PathBuf,
}

impl RepositoryStorage {
    pub fn new(storage_root: PathBuf, git_binary: PathBuf) -> Self {
        Self {
            storage_root: normalize_root(storage_root),
            git_binary,
        }
    }

    pub fn repository_path(&self, repository_id: &str) -> Result<PathBuf, RepositoryError> {
        let repository_id = RepositoryId::parse(repository_id)?;

        Ok(repository_path(&self.storage_root, &repository_id))
    }

    pub async fn create_repository(
        &self,
        repository_id: &RepositoryId,
    ) -> Result<RepositoryCreated, RepositoryError> {
        let repository_path = repository_path(&self.storage_root, repository_id);
        self.ensure_repositories_root().await?;

        if let Ok(metadata) = fs::symlink_metadata(&repository_path).await
            && metadata.file_type().is_symlink()
        {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }

        let repositories_root = repositories_root(&self.storage_root);

        if fs::try_exists(&repository_path)
            .await
            .map_err(RepositoryError::StorageIo)?
        {
            if is_bare_repository(&repository_path, &repositories_root).await? {
                return Ok(RepositoryCreated {
                    path: repository_path,
                    created: false,
                });
            }

            return Err(RepositoryError::ExistingPathNotBare);
        }

        let output = timeout(
            Duration::from_secs(15),
            Command::new(&self.git_binary)
                .arg("init")
                .arg("--bare")
                .arg(&repository_path)
                .output(),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
        .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        if !is_bare_repository(&repository_path, &repositories_root).await? {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(RepositoryCreated {
            path: repository_path,
            created: true,
        })
    }

    async fn ensure_repositories_root(&self) -> Result<(), RepositoryError> {
        fs::create_dir_all(&self.storage_root)
            .await
            .map_err(RepositoryError::StorageIo)?;

        let repositories_root = repositories_root(&self.storage_root);

        if let Ok(metadata) = fs::symlink_metadata(&repositories_root).await
            && metadata.file_type().is_symlink()
        {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }

        fs::create_dir_all(&repositories_root)
            .await
            .map_err(RepositoryError::StorageIo)?;

        let canonical_root = fs::canonicalize(&self.storage_root)
            .await
            .map_err(RepositoryError::StorageIo)?;
        let canonical_repositories_root = fs::canonicalize(&repositories_root)
            .await
            .map_err(RepositoryError::StorageIo)?;

        if !canonical_repositories_root.starts_with(canonical_root) {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }

        Ok(())
    }
}

fn repository_path(storage_root: &Path, repository_id: &RepositoryId) -> PathBuf {
    repositories_root(storage_root).join(format!("{repository_id}.git"))
}

fn repositories_root(storage_root: &Path) -> PathBuf {
    storage_root.join("repositories")
}

fn normalize_root(storage_root: PathBuf) -> PathBuf {
    let absolute_root = if storage_root.is_absolute() {
        storage_root
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(storage_root)
    };

    normalize_path(&absolute_root)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

async fn is_bare_repository(
    path: &Path,
    repositories_root: &Path,
) -> Result<bool, RepositoryError> {
    let metadata = fs::symlink_metadata(path)
        .await
        .map_err(RepositoryError::StorageIo)?;

    if metadata.file_type().is_symlink() {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    let canonical_repositories_root = fs::canonicalize(repositories_root)
        .await
        .map_err(RepositoryError::StorageIo)?;
    let canonical_path = fs::canonicalize(path)
        .await
        .map_err(RepositoryError::StorageIo)?;

    if !canonical_path.starts_with(canonical_repositories_root) {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    for marker_path in [
        path.join("HEAD"),
        path.join("config"),
        path.join("objects"),
        path.join("refs"),
    ] {
        let Ok(marker_metadata) = fs::symlink_metadata(&marker_path).await else {
            return Ok(false);
        };

        if marker_metadata.file_type().is_symlink() {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }
    }

    let config_path = path.join("config");
    let Ok(config) = fs::read_to_string(config_path).await else {
        return Ok(false);
    };

    Ok(fs::metadata(path)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
        && fs::metadata(path.join("HEAD"))
            .await
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
        && fs::metadata(path.join("objects"))
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
        && fs::metadata(path.join("refs"))
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
        && config_has_core_bare_enabled(&config))
}

fn config_has_core_bare_enabled(config: &str) -> bool {
    let mut in_core_section = false;
    let mut bare = None;

    for line in config.lines().map(str::trim) {
        if line.starts_with('[') && line.ends_with(']') {
            in_core_section = line == "[core]";
            continue;
        }

        if !in_core_section {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        if key.trim() == "bare" {
            bare = Some(value.trim() == "true");
        }
    }

    bare.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_path_uses_uuid_under_repositories_root() {
        let storage = RepositoryStorage::new(
            PathBuf::from("/tmp/tessera-git-storage"),
            PathBuf::from("git"),
        );
        let repository_id = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";

        let path = storage.repository_path(repository_id).unwrap();

        assert_eq!(
            path,
            PathBuf::from(
                "/tmp/tessera-git-storage/repositories/018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5.git"
            )
        );
    }

    #[test]
    fn repository_path_rejects_non_uuid_values() {
        let storage = RepositoryStorage::new(
            PathBuf::from("/tmp/tessera-git-storage"),
            PathBuf::from("git"),
        );

        let error = storage.repository_path("../outside").unwrap_err();

        assert!(matches!(error, RepositoryError::InvalidRepositoryId));
    }

    #[test]
    fn config_bare_check_uses_core_section_last_value() {
        let config = r#"
            [other]
                bare = true
            [core]
                bare = true
                bare = false
        "#;

        assert!(!config_has_core_bare_enabled(config));
    }

    #[test]
    fn config_bare_check_accepts_core_bare_true() {
        let config = r#"
            [other]
                bare = false
            [core]
                bare = false
                bare = true
        "#;

        assert!(config_has_core_bare_enabled(config));
    }
}
