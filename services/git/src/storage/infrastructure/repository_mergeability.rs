use std::path::Path;

use tokio::time::{Duration, timeout};

use crate::domain::{RepositoryError, RepositoryMergeability};
use crate::storage::infrastructure::repository_merge_helpers::{
    MergeTreeOutcome, resolve_merge_refs, run_merge_tree,
};
use crate::storage::infrastructure::repository_ref_helpers::utf8_trimmed;
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const MERGEABILITY_OPERATION_TIMEOUT: Duration = Duration::from_secs(45);
const CONFLICT_PATH_LIMIT: usize = 50;

impl RepositoryStorage {
    /// Reports whether two branches merge cleanly without creating a commit or moving a ref.
    pub async fn check_repository_mergeability(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
    ) -> Result<RepositoryMergeability, RepositoryError> {
        timeout(
            MERGEABILITY_OPERATION_TIMEOUT,
            self.check_repository_mergeability_inner(
                repository_id,
                storage_path,
                base_ref,
                head_ref,
            ),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
    }

    async fn check_repository_mergeability_inner(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
    ) -> Result<RepositoryMergeability, RepositoryError> {
        let resolved =
            resolve_merge_refs(self, repository_id, storage_path, base_ref, head_ref).await?;
        let merge_base_sha = self
            .resolve_merge_base(
                &resolved.repository_path,
                &resolved.base_sha,
                &resolved.head_sha,
            )
            .await?;
        let outcome = run_merge_tree(
            self,
            &resolved.repository_path,
            [
                "merge-tree",
                "--write-tree",
                "--name-only",
                "-z",
                &resolved.base_sha,
                &resolved.head_sha,
            ],
        )
        .await?;
        let (mergeable, mut conflict_paths) = match outcome {
            MergeTreeOutcome::Clean(_) => (true, Vec::new()),
            MergeTreeOutcome::Conflicted(stdout) => (false, parse_conflict_paths(&stdout)),
        };
        let conflict_paths_truncated = conflict_paths.len() > CONFLICT_PATH_LIMIT;
        conflict_paths.truncate(CONFLICT_PATH_LIMIT);

        Ok(RepositoryMergeability {
            mergeable,
            base_sha: resolved.base_sha,
            head_sha: resolved.head_sha,
            merge_base_sha,
            conflict_paths,
            conflict_paths_truncated,
            conflict_path_limit: CONFLICT_PATH_LIMIT as u32,
        })
    }

    async fn resolve_merge_base(
        &self,
        repository_path: &Path,
        base_sha: &str,
        head_sha: &str,
    ) -> Result<String, RepositoryError> {
        let output = self
            .git(repository_path, ["merge-base", base_sha, head_sha])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::RepositoryObjectNotFound);
        }

        let merge_base_sha = utf8_trimmed(&output.stdout)?;
        if merge_base_sha.is_empty() {
            return Err(RepositoryError::InvalidGitOutput);
        }

        Ok(merge_base_sha)
    }
}

/// Reads the conflicted file section of `git merge-tree --write-tree --name-only -z`, which
/// follows the written tree id and ends at the empty record before the informational messages.
fn parse_conflict_paths(output: &[u8]) -> Vec<String> {
    output
        .split(|byte| *byte == 0)
        .skip(1)
        .take_while(|record| !record.is_empty())
        .map(|record| String::from_utf8_lossy(record).into_owned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conflict_paths_stop_before_informational_messages() {
        let output = b"tree-sha\0src/a.txt\0src/b.txt\0\0CONFLICT (content)\0";

        assert_eq!(parse_conflict_paths(output), ["src/a.txt", "src/b.txt"]);
    }

    #[test]
    fn conflict_paths_are_empty_without_a_conflicted_section() {
        assert_eq!(parse_conflict_paths(b"tree-sha\0"), Vec::<String>::new());
    }
}
