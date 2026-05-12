use std::env;
use std::path::{Component, Path, PathBuf};

use tokio::process::Command;

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

        if let Ok(metadata) = std::fs::symlink_metadata(&repository_path) {
            if metadata.file_type().is_symlink() {
                return Err(RepositoryError::PathEscapesStorageRoot);
            }
        }

        let repositories_root = repositories_root(&self.storage_root);

        if repository_path.exists() {
            if is_bare_repository(&repository_path, &repositories_root)? {
                return Ok(RepositoryCreated {
                    path: repository_path,
                    created: false,
                });
            }

            return Err(RepositoryError::ExistingPathNotBare);
        }

        let output = Command::new(&self.git_binary)
            .arg("init")
            .arg("--bare")
            .arg(&repository_path)
            .output()
            .await
            .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        if !is_bare_repository(&repository_path, &repositories_root)? {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(RepositoryCreated {
            path: repository_path,
            created: true,
        })
    }

    async fn ensure_repositories_root(&self) -> Result<(), RepositoryError> {
        tokio::fs::create_dir_all(&self.storage_root)
            .await
            .map_err(RepositoryError::StorageIo)?;

        let repositories_root = repositories_root(&self.storage_root);

        if let Ok(metadata) = tokio::fs::symlink_metadata(&repositories_root).await {
            if metadata.file_type().is_symlink() {
                return Err(RepositoryError::PathEscapesStorageRoot);
            }
        }

        tokio::fs::create_dir_all(&repositories_root)
            .await
            .map_err(RepositoryError::StorageIo)?;

        let canonical_root = self
            .storage_root
            .canonicalize()
            .map_err(RepositoryError::StorageIo)?;
        let canonical_repositories_root = repositories_root
            .canonicalize()
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
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn is_bare_repository(path: &Path, repositories_root: &Path) -> Result<bool, RepositoryError> {
    let metadata = std::fs::symlink_metadata(path).map_err(RepositoryError::StorageIo)?;

    if metadata.file_type().is_symlink() {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    let canonical_repositories_root = repositories_root
        .canonicalize()
        .map_err(RepositoryError::StorageIo)?;
    let canonical_path = path.canonicalize().map_err(RepositoryError::StorageIo)?;

    if !canonical_path.starts_with(canonical_repositories_root) {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    let config_path = path.join("config");
    let Ok(config) = std::fs::read_to_string(config_path) else {
        return Ok(false);
    };

    for marker_path in [
        path.join("HEAD"),
        path.join("config"),
        path.join("objects"),
        path.join("refs"),
    ] {
        let Ok(marker_metadata) = std::fs::symlink_metadata(marker_path) else {
            return Ok(false);
        };

        if marker_metadata.file_type().is_symlink() {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }
    }

    Ok(path.is_dir()
        && path.join("HEAD").is_file()
        && path.join("objects").is_dir()
        && path.join("refs").is_dir()
        && config
            .lines()
            .map(str::trim)
            .any(|line| line == "bare = true" || line == "bare=true"))
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
}
