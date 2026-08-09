use std::path::{Path, PathBuf};

use crate::domain::RepositoryError;
use crate::storage::infrastructure::repository_ref_helpers::{
    qualified_branch_ref, resolve_commit_ref,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

pub(super) struct ResolvedMergeRefs {
    pub repository_path: PathBuf,
    pub base_ref: String,
    pub head_ref: String,
    pub base_sha: String,
    pub head_sha: String,
}

pub(super) enum MergeTreeOutcome {
    Clean(Vec<u8>),
    Conflicted(Vec<u8>),
}

pub(super) async fn resolve_merge_refs(
    storage: &RepositoryStorage,
    repository_id: &str,
    storage_path: &str,
    base_ref: &str,
    head_ref: &str,
) -> Result<ResolvedMergeRefs, RepositoryError> {
    let repository_path = storage
        .existing_bare_repository_path(repository_id, storage_path)
        .await?;
    let base_ref = qualified_branch_ref(base_ref)?;
    let head_ref = qualified_branch_ref(head_ref)?;
    let base_sha = resolve_commit_ref(storage, &repository_path, &base_ref).await?;
    let head_sha = resolve_commit_ref(storage, &repository_path, &head_ref).await?;

    Ok(ResolvedMergeRefs {
        repository_path,
        base_ref,
        head_ref,
        base_sha,
        head_sha,
    })
}

/// Runs `git merge-tree` and classifies its exit status, where code 1 means the refs conflict.
pub(super) async fn run_merge_tree<const N: usize>(
    storage: &RepositoryStorage,
    repository_path: &Path,
    args: [&str; N],
) -> Result<MergeTreeOutcome, RepositoryError> {
    let output = storage.git(repository_path, args).await?;

    if output.status.success() {
        return Ok(MergeTreeOutcome::Clean(output.stdout));
    }

    match output.status.code() {
        Some(1) => Ok(MergeTreeOutcome::Conflicted(output.stdout)),
        _ => Err(RepositoryError::GitProcessFailed),
    }
}
