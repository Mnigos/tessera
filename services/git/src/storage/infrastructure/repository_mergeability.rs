use std::path::{Path, PathBuf};

use tokio::fs;
use tokio::time::{Duration, timeout};
use uuid::Uuid;

use crate::domain::{
    RepositoryError, RepositoryMergeStrategy, RepositoryMergeStrategyAvailability,
    RepositoryMergeStrategyUnavailableReason, RepositoryMergeability,
};
use crate::storage::infrastructure::repository_merge_helpers::{
    MergeTreeOutcome, ObjectStore, resolve_merge_refs, run_merge_tree,
};
use crate::storage::infrastructure::repository_merge_rebase::{
    RebaseReplay, replay_source_commits,
};
use crate::storage::infrastructure::repository_ref_helpers::utf8_trimmed;
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

/// Bounded like the merge it clears the way for, and for the same reason: every
/// caller waits on this answer while holding the repository's merge lease.
pub const MERGEABILITY_OPERATION_TIMEOUT: Duration = Duration::from_secs(45);
const CONFLICT_PATH_LIMIT: usize = 50;

/// Whoever the replay names as committer, which nothing here keeps: the objects
/// it writes go to a scratch store that is deleted before this returns.
const SIMULATED_COMMITTER_NAME: &str = "Tessera";
const SIMULATED_COMMITTER_EMAIL: &str = "merge@tessera.invalid";

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
        let scratch = ScratchObjectStore::create(&resolved.repository_path).await?;
        let outcome = run_merge_tree(
            self,
            &resolved.repository_path,
            scratch.objects(),
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
        let strategy_availability = self
            .resolve_strategy_availability(
                &resolved.repository_path,
                scratch.objects(),
                StrategyAvailabilityInput {
                    base_sha: &resolved.base_sha,
                    head_sha: &resolved.head_sha,
                    merge_base_sha: &merge_base_sha,
                    mergeable,
                },
            )
            .await?;

        Ok(RepositoryMergeability {
            mergeable,
            base_sha: resolved.base_sha,
            head_sha: resolved.head_sha,
            merge_base_sha,
            conflict_paths,
            conflict_paths_truncated,
            conflict_path_limit: CONFLICT_PATH_LIMIT as u32,
            strategy_availability,
        })
    }

    /// One answer per strategy, each decided the way that strategy actually
    /// runs. A conflict between the two tips refuses the strategies that combine
    /// them; ancestry decides the fast-forward; and only replaying the commits
    /// can say whether a rebase would go through, because a clean two-tip merge
    /// proves nothing about applying those commits one at a time.
    async fn resolve_strategy_availability(
        &self,
        repository_path: &Path,
        objects: ObjectStore<'_>,
        input: StrategyAvailabilityInput<'_>,
    ) -> Result<Vec<RepositoryMergeStrategyAvailability>, RepositoryError> {
        let combined =
            (!input.mergeable).then_some(RepositoryMergeStrategyUnavailableReason::Conflict);

        Ok(vec![
            availability(RepositoryMergeStrategy::MergeCommit, combined),
            availability(RepositoryMergeStrategy::Squash, combined),
            availability(
                RepositoryMergeStrategy::Rebase,
                self.simulate_rebase(repository_path, objects, &input)
                    .await?,
            ),
            availability(
                RepositoryMergeStrategy::FastForward,
                fast_forward_reason(&input),
            ),
        ])
    }

    async fn simulate_rebase(
        &self,
        repository_path: &Path,
        objects: ObjectStore<'_>,
        input: &StrategyAvailabilityInput<'_>,
    ) -> Result<Option<RepositoryMergeStrategyUnavailableReason>, RepositoryError> {
        let replay = replay_source_commits(
            self,
            repository_path,
            objects,
            input.base_sha,
            input.head_sha,
            SIMULATED_COMMITTER_NAME,
            SIMULATED_COMMITTER_EMAIL,
        )
        .await?;

        Ok(match replay {
            RebaseReplay::Replayed(_) => None,
            RebaseReplay::Unavailable(reason) => Some(reason),
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

struct StrategyAvailabilityInput<'a> {
    base_sha: &'a str,
    head_sha: &'a str,
    merge_base_sha: &'a str,
    mergeable: bool,
}

/// An object store that exists only for the length of one answer.
///
/// Deciding whether a rebase would go through means performing it, and
/// performing it writes objects. Every pull request page asks this question, so
/// writing those objects into the repository would grow it by a whole replay per
/// read, none of it reachable. They go here instead.
///
/// Cleanup is in `Drop` rather than at the end of the happy path, because the
/// paths that most need it are the ones that never reach the end: a Git
/// subprocess that fails returns through `?`, and the operation timeout drops
/// this future outright. Both still run destructors.
struct ScratchObjectStore {
    path: PathBuf,
}

impl ScratchObjectStore {
    async fn create(repository_path: &Path) -> Result<Self, RepositoryError> {
        let path = repository_path.join(format!("tessera-mergeability-{}", Uuid::new_v4()));
        // `commit-tree` and `merge-tree` write straight into the loose-object
        // fan-out, and neither creates the store it was pointed at.
        fs::create_dir_all(&path)
            .await
            .map_err(RepositoryError::StorageIo)?;

        Ok(Self { path })
    }

    fn objects(&self) -> ObjectStore<'_> {
        ObjectStore::scratch(&self.path)
    }
}

impl Drop for ScratchObjectStore {
    /// Synchronous on purpose: a dropped future has no executor left to await
    /// on, and this is the only moment a cancelled answer can still clean up
    /// after itself. Failing to is worth a line in the log and nothing more —
    /// the answer is already correct, and refusing it over a leftover directory
    /// would turn a housekeeping problem into an unmergeable pull request.
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.path) {
            tracing::warn!(
                path = %self.path.display(),
                %error,
                "failed to remove the mergeability scratch object store"
            );
        }
    }
}

/// A fast-forward needs the target to already be an ancestor of the source,
/// which is exactly the merge base being the target. Equal tips are already up
/// to date rather than an advance to nowhere.
fn fast_forward_reason(
    input: &StrategyAvailabilityInput<'_>,
) -> Option<RepositoryMergeStrategyUnavailableReason> {
    if input.base_sha == input.head_sha {
        return Some(RepositoryMergeStrategyUnavailableReason::AlreadyUpToDate);
    }

    (input.merge_base_sha != input.base_sha)
        .then_some(RepositoryMergeStrategyUnavailableReason::NotFastForward)
}

fn availability(
    strategy: RepositoryMergeStrategy,
    reason: Option<RepositoryMergeStrategyUnavailableReason>,
) -> RepositoryMergeStrategyAvailability {
    RepositoryMergeStrategyAvailability {
        strategy,
        available: reason.is_none(),
        reason,
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

    fn input<'a>(
        base_sha: &'a str,
        head_sha: &'a str,
        merge_base_sha: &'a str,
    ) -> StrategyAvailabilityInput<'a> {
        StrategyAvailabilityInput {
            base_sha,
            head_sha,
            merge_base_sha,
            mergeable: true,
        }
    }

    #[test]
    fn conflict_paths_stop_before_informational_messages() {
        let output = b"tree-sha\0src/a.txt\0src/b.txt\0\0CONFLICT (content)\0";

        assert_eq!(parse_conflict_paths(output), ["src/a.txt", "src/b.txt"]);
    }

    #[test]
    fn conflict_paths_are_empty_without_a_conflicted_section() {
        assert_eq!(parse_conflict_paths(b"tree-sha\0"), Vec::<String>::new());
    }

    #[test]
    fn a_target_that_is_an_ancestor_of_the_source_fast_forwards() {
        assert_eq!(fast_forward_reason(&input("base", "head", "base")), None);
    }

    #[test]
    fn diverged_branches_cannot_fast_forward() {
        assert_eq!(
            fast_forward_reason(&input("base", "head", "older")),
            Some(RepositoryMergeStrategyUnavailableReason::NotFastForward)
        );
    }

    #[test]
    fn equal_tips_are_already_up_to_date_rather_than_a_fast_forward() {
        assert_eq!(
            fast_forward_reason(&input("same", "same", "same")),
            Some(RepositoryMergeStrategyUnavailableReason::AlreadyUpToDate)
        );
    }
}
