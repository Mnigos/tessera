use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use tokio::fs;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{RepositoryCreated, RepositoryError, RepositoryId, RepositoryImported};
use crate::storage::infrastructure::bare_repository::is_bare_repository;
use crate::storage::infrastructure::repository_paths::{
    normalize_root, repositories_root, repository_path,
};
use crate::storage::infrastructure::repository_security::reject_symlink;

#[derive(Clone, Debug)]
pub struct RepositoryStorage {
    storage_root: PathBuf,
    pub(super) git_binary: PathBuf,
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
        tracing::info!(
            repository_id = %repository_id,
            path = %repository_path.display(),
            "creating repository"
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
        tracing::info!(
            repository_id = %repository_id,
            storage_path = %storage_path,
            "repository created"
        );

        Ok(RepositoryCreated {
            path: repository_path,
            storage_path,
            created: true,
        })
    }

    pub async fn import_repository(
        &self,
        repository_id: &RepositoryId,
        storage_path: &str,
        source_url: &str,
        access_token: Option<&str>,
        default_branch_hint: &str,
    ) -> Result<RepositoryImported, RepositoryError> {
        if source_url.trim().is_empty() {
            return Err(RepositoryError::InvalidRepositoryPath);
        }

        let repository_path = repository_path(&self.storage_root, repository_id);
        let expected_storage_path = repository_path.display().to_string();

        if storage_path != expected_storage_path {
            return Err(RepositoryError::StoragePathMismatch);
        }

        tracing::info!(
            repository_id = %repository_id,
            storage_path = %storage_path,
            "importing repository"
        );

        self.ensure_repositories_root().await?;

        if let Ok(metadata) = fs::symlink_metadata(&repository_path).await
            && metadata.file_type().is_symlink()
        {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }

        if fs::try_exists(&repository_path)
            .await
            .map_err(RepositoryError::StorageIo)?
        {
            let repositories_root = repositories_root(&self.storage_root);

            if !is_bare_repository(&repository_path, &repositories_root).await? {
                return Err(RepositoryError::ExistingPathNotBare);
            }

            self.fetch_repository_mirror(&repository_path, source_url, access_token)
                .await?;
        } else {
            self.clone_repository_mirror(&repository_path, source_url, access_token)
                .await?;
        }

        self.ensure_bare_repository_in_root(&self.storage_root, &repository_path)
            .await?;

        let default_branch = self
            .resolve_import_default_branch(&repository_path, default_branch_hint)
            .await?;

        Ok(RepositoryImported {
            default_branch,
            storage_path: expected_storage_path,
        })
    }

    pub async fn existing_bare_repository_path(
        &self,
        repository_id: &str,
        storage_path: &str,
    ) -> Result<PathBuf, RepositoryError> {
        let repository_id = RepositoryId::parse(repository_id)?;
        let repository_path = repository_path(&self.storage_root, &repository_id);
        tracing::info!(
            repository_id = %repository_id,
            storage_path = %storage_path,
            path = %repository_path.display(),
            "resolving repository"
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
            tracing::warn!(
                repository_id = %repository_id,
                path = %repository_path.display(),
                "repository path is not bare repository"
            );
            return Err(RepositoryError::ExistingPathNotBare);
        }

        tracing::info!(
            repository_id = %repository_id,
            path = %repository_path.display(),
            "repository ready"
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

    async fn clone_repository_mirror(
        &self,
        repository_path: &Path,
        source_url: &str,
        access_token: Option<&str>,
    ) -> Result<(), RepositoryError> {
        let temporary_repository_path = temporary_import_path(repository_path);
        let mut command = Command::new(&self.git_binary);
        add_access_token_config(&mut command, access_token);
        let output = timeout(
            Duration::from_secs(120),
            command
                .arg("clone")
                .arg("--mirror")
                .arg(source_url)
                .arg(&temporary_repository_path)
                .output(),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
        .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            cleanup_created_repository(&temporary_repository_path).await;

            return Err(RepositoryError::GitProcessFailed);
        }

        reject_symlink(&temporary_repository_path).await?;
        if let Err(error) = fs::rename(&temporary_repository_path, repository_path).await {
            cleanup_created_repository(&temporary_repository_path).await;

            if error.kind() != std::io::ErrorKind::AlreadyExists {
                return Err(RepositoryError::StorageIo(error));
            }
        }

        Ok(())
    }

    async fn fetch_repository_mirror(
        &self,
        repository_path: &Path,
        source_url: &str,
        access_token: Option<&str>,
    ) -> Result<(), RepositoryError> {
        let mut command = Command::new(&self.git_binary);
        add_access_token_config(&mut command, access_token);
        let output = timeout(
            Duration::from_secs(120),
            command
                .arg("--git-dir")
                .arg(repository_path)
                .arg("fetch")
                .arg("--prune")
                .arg(source_url)
                .arg("+refs/*:refs/*")
                .output(),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
        .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(())
    }

    async fn resolve_import_default_branch(
        &self,
        repository_path: &Path,
        default_branch_hint: &str,
    ) -> Result<String, RepositoryError> {
        let hinted_branch = default_branch_hint.trim();

        if !hinted_branch.is_empty()
            && branch_exists(&self.git_binary, repository_path, hinted_branch).await?
        {
            set_symbolic_head(&self.git_binary, repository_path, hinted_branch).await?;

            return Ok(hinted_branch.to_string());
        }

        if let Some(default_branch) = symbolic_head(&self.git_binary, repository_path).await? {
            return Ok(default_branch);
        }

        let output = timeout(
            Duration::from_secs(15),
            Command::new(&self.git_binary)
                .arg("--git-dir")
                .arg(repository_path)
                .arg("for-each-ref")
                .arg("--format=%(refname:short)")
                .arg("--count=1")
                .arg("refs/heads")
                .output(),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
        .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        let default_branch = String::from_utf8(output.stdout)
            .map_err(|_| RepositoryError::InvalidGitOutput)?
            .trim()
            .to_string();

        if default_branch.is_empty() {
            if hinted_branch.is_empty() {
                return Err(RepositoryError::InvalidRepositoryRef);
            }

            set_symbolic_head(&self.git_binary, repository_path, hinted_branch).await?;

            return Ok(hinted_branch.to_string());
        }

        set_symbolic_head(&self.git_binary, repository_path, &default_branch).await?;

        Ok(default_branch)
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

fn add_access_token_config(command: &mut Command, access_token: Option<&str>) {
    if let Some(access_token) = access_token
        && !access_token.is_empty()
    {
        let credentials = base64::engine::general_purpose::STANDARD
            .encode(format!("x-access-token:{access_token}"));

        command
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "http.extraHeader")
            .env(
                "GIT_CONFIG_VALUE_0",
                format!("Authorization: Basic {credentials}"),
            );
    }
}

async fn branch_exists(
    git_binary: &Path,
    repository_path: &Path,
    branch_name: &str,
) -> Result<bool, RepositoryError> {
    let output = timeout(
        Duration::from_secs(15),
        Command::new(git_binary)
            .arg("--git-dir")
            .arg(repository_path)
            .arg("show-ref")
            .arg("--verify")
            .arg("--quiet")
            .arg(format!("refs/heads/{branch_name}"))
            .output(),
    )
    .await
    .map_err(|_| RepositoryError::GitProcessFailed)?
    .map_err(RepositoryError::GitProcessIo)?;

    Ok(output.status.success())
}

async fn symbolic_head(
    git_binary: &Path,
    repository_path: &Path,
) -> Result<Option<String>, RepositoryError> {
    let output = timeout(
        Duration::from_secs(15),
        Command::new(git_binary)
            .arg("--git-dir")
            .arg(repository_path)
            .arg("symbolic-ref")
            .arg("--quiet")
            .arg("--short")
            .arg("HEAD")
            .output(),
    )
    .await
    .map_err(|_| RepositoryError::GitProcessFailed)?
    .map_err(RepositoryError::GitProcessIo)?;

    if !output.status.success() {
        return Ok(None);
    }

    let branch_name = String::from_utf8(output.stdout)
        .map_err(|_| RepositoryError::InvalidGitOutput)?
        .trim()
        .to_string();

    if branch_name.is_empty() {
        return Ok(None);
    }

    if branch_exists(git_binary, repository_path, &branch_name).await? {
        return Ok(Some(branch_name));
    }

    Ok(None)
}

async fn set_symbolic_head(
    git_binary: &Path,
    repository_path: &Path,
    branch_name: &str,
) -> Result<(), RepositoryError> {
    let output = timeout(
        Duration::from_secs(15),
        Command::new(git_binary)
            .arg("--git-dir")
            .arg(repository_path)
            .arg("symbolic-ref")
            .arg("HEAD")
            .arg(format!("refs/heads/{branch_name}"))
            .output(),
    )
    .await
    .map_err(|_| RepositoryError::GitProcessFailed)?
    .map_err(RepositoryError::GitProcessIo)?;

    if !output.status.success() {
        return Err(RepositoryError::GitProcessFailed);
    }

    Ok(())
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

fn temporary_import_path(repository_path: &Path) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = repository_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("repository.git");

    repository_path.with_file_name(format!("{file_name}.import-{suffix}"))
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
