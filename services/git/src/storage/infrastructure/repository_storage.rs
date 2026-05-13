use std::path::{Path, PathBuf};

use tokio::fs;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{RepositoryCreated, RepositoryError, RepositoryId};
use crate::storage::infrastructure::bare_repository::is_bare_repository;
use crate::storage::infrastructure::repository_paths::{
    normalize_root, repositories_root, repository_path,
};
use crate::storage::infrastructure::repository_security::reject_symlink;

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
        eprintln!(
            "[tessera-git] creating repository repository_id={repository_id} path={}",
            repository_path.display()
        );
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
                    storage_path: repository_path.display().to_string(),
                    path: repository_path,
                    created: false,
                });
            }

            return Err(RepositoryError::ExistingPathNotBare);
        }

        fs::create_dir(&repository_path)
            .await
            .map_err(RepositoryError::StorageIo)?;

        if let Err(error) = self.initialize_created_repository(&repository_path).await {
            cleanup_created_repository(&repository_path).await;

            return Err(error);
        }

        let storage_path = repository_path.display().to_string();
        eprintln!(
            "[tessera-git] repository created repository_id={repository_id} storage_path={storage_path}"
        );

        Ok(RepositoryCreated {
            path: repository_path,
            storage_path,
            created: true,
        })
    }

    pub async fn existing_bare_repository_path(
        &self,
        repository_id: &str,
        storage_path: &str,
    ) -> Result<PathBuf, RepositoryError> {
        let repository_id = RepositoryId::parse(repository_id)?;
        let repository_path = repository_path(&self.storage_root, &repository_id);
        eprintln!(
            "[tessera-git] resolving repository repository_id={repository_id} storage_path={storage_path} path={}",
            repository_path.display()
        );

        if storage_path != repository_path.display().to_string() {
            return Err(RepositoryError::StoragePathMismatch);
        }

        self.ensure_repositories_root().await?;

        if !fs::try_exists(&repository_path)
            .await
            .map_err(RepositoryError::StorageIo)?
        {
            return Err(RepositoryError::ExistingPathNotBare);
        }

        let repositories_root = repositories_root(&self.storage_root);

        if !is_bare_repository(&repository_path, &repositories_root).await? {
            eprintln!(
                "[tessera-git] repository path is not bare repository repository_id={repository_id} path={}",
                repository_path.display()
            );
            return Err(RepositoryError::ExistingPathNotBare);
        }

        eprintln!(
            "[tessera-git] repository ready repository_id={repository_id} path={}",
            repository_path.display()
        );
        Ok(repository_path)
    }

    async fn initialize_created_repository(
        &self,
        repository_path: &PathBuf,
    ) -> Result<(), RepositoryError> {
        reject_symlink(repository_path).await?;
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

        self.ensure_bare_repository_in_root(&self.storage_root, repository_path)
            .await?;

        Ok(())
    }

    async fn ensure_repositories_root(&self) -> Result<(), RepositoryError> {
        ensure_repositories_root(&self.storage_root).await
    }

    async fn ensure_bare_repository_in_root(
        &self,
        storage_root: &Path,
        repository_path: &PathBuf,
    ) -> Result<(), RepositoryError> {
        let repositories_root = repositories_root(storage_root);

        if !is_bare_repository(repository_path, &repositories_root).await? {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(())
    }
}

async fn ensure_repositories_root(storage_root: &Path) -> Result<(), RepositoryError> {
    fs::create_dir_all(storage_root)
        .await
        .map_err(RepositoryError::StorageIo)?;

    let repositories_root = repositories_root(storage_root);

    if let Ok(metadata) = fs::symlink_metadata(&repositories_root).await
        && metadata.file_type().is_symlink()
    {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    fs::create_dir_all(&repositories_root)
        .await
        .map_err(RepositoryError::StorageIo)?;

    let canonical_root = fs::canonicalize(storage_root)
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

async fn cleanup_created_repository(repository_path: &PathBuf) {
    let _ = fs::remove_dir_all(repository_path).await;
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
