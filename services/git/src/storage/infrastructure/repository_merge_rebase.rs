use std::path::Path;

use crate::domain::{RepositoryError, RepositoryMergeStrategyUnavailableReason};
use crate::storage::infrastructure::repository_merge_helpers::{
    CommitTreeRequest, MergeTreeOutcome, ObjectStore, create_commit, resolve_commit_tree,
    run_merge_tree,
};
use crate::storage::infrastructure::repository_merge_message::replayed_commit_message;
use crate::storage::infrastructure::repository_ref_helpers::utf8_trimmed;
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

/// How many source commits a rebase will replay.
///
/// Every commit costs three Git processes, and the replay runs both to merge and
/// to answer whether a merge is possible — the second of which happens on every
/// pull request page load. A history longer than this is refused with a reason
/// rather than allowed to run either clock out. One constant serves both paths
/// deliberately: an availability answer that disagreed with the merge would
/// offer a method that is then refused, or hide one that would have worked.
const REBASE_COMMIT_LIMIT: usize = 50;

const RECORD_SEPARATOR: u8 = 0x1e;
const FIELD_SEPARATOR: u8 = 0;

/// Where a replay ended up. `Unavailable` covers everything that makes this
/// history un-rebaseable, conflicts included, because the caller that merges and
/// the caller that only asks report those two differently.
pub(super) enum RebaseReplay {
    Replayed(String),
    Unavailable(RepositoryMergeStrategyUnavailableReason),
}

struct SourceCommit {
    sha: String,
    /// Absent on a root commit, which has no diff to replay and no merge base to
    /// take one against.
    parent_sha: Option<String>,
    author_name: String,
    author_email: String,
    author_date: String,
    message: Vec<u8>,
}

/// Rebuilds every source-only commit on top of the target, in order.
///
/// Nothing here touches a ref. The caller is handed one commit to move the
/// target to, so a replay that fails halfway leaves only unreachable loose
/// objects behind — there is no partial rebase to clean up, by construction.
///
/// Source merge commits are dropped and their reachable non-merge commits are
/// replayed instead, which is what `git rebase` does by default. A commit whose
/// replay changes nothing is dropped, matching how the hosted forges present a
/// rebase merge.
pub(super) async fn replay_source_commits(
    storage: &RepositoryStorage,
    repository_path: &Path,
    objects: ObjectStore<'_>,
    base_sha: &str,
    head_sha: &str,
    committer_name: &str,
    committer_email: &str,
) -> Result<RebaseReplay, RepositoryError> {
    if base_sha == head_sha {
        return Ok(RebaseReplay::Unavailable(
            RepositoryMergeStrategyUnavailableReason::AlreadyUpToDate,
        ));
    }

    let commits = list_source_commits(storage, repository_path, base_sha, head_sha).await?;

    if commits.is_empty() {
        return Ok(RebaseReplay::Unavailable(
            RepositoryMergeStrategyUnavailableReason::NothingToRebase,
        ));
    }

    if commits.len() > REBASE_COMMIT_LIMIT {
        return Ok(RebaseReplay::Unavailable(
            RepositoryMergeStrategyUnavailableReason::UnsupportedHistory,
        ));
    }

    let mut tip_sha = base_sha.to_string();
    let mut tip_tree_sha = resolve_commit_tree(storage, repository_path, base_sha).await?;

    for commit in commits {
        let Some(parent_sha) = commit.parent_sha else {
            return Ok(RebaseReplay::Unavailable(
                RepositoryMergeStrategyUnavailableReason::UnsupportedHistory,
            ));
        };
        // Git 2.39 cannot be told which merge base to use, so the replay is
        // staged through a throwaway commit that holds the rebased tree and the
        // original commit's parent. `merge-tree` then finds that parent as the
        // merge base on its own and applies exactly this commit's changes.
        let staged_sha = create_commit(
            storage,
            repository_path,
            objects,
            CommitTreeRequest {
                tree_sha: &tip_tree_sha,
                parents: &[&parent_sha],
                author_name: committer_name,
                author_email: committer_email,
                author_date: None,
                committer_name,
                committer_email,
                message: b"Tessera rebase staging\n",
            },
        )
        .await?;
        let outcome = run_merge_tree(
            storage,
            repository_path,
            objects,
            [
                "merge-tree",
                "--write-tree",
                "--messages",
                &staged_sha,
                &commit.sha,
            ],
        )
        .await?;
        let replayed_tree_sha = match outcome {
            MergeTreeOutcome::Clean(stdout) => first_line(&stdout)?,
            MergeTreeOutcome::Conflicted(_) => {
                return Ok(RebaseReplay::Unavailable(
                    RepositoryMergeStrategyUnavailableReason::Conflict,
                ));
            }
        };

        if replayed_tree_sha == tip_tree_sha {
            continue;
        }

        tip_sha = create_commit(
            storage,
            repository_path,
            objects,
            CommitTreeRequest {
                tree_sha: &replayed_tree_sha,
                parents: &[&tip_sha],
                author_name: &commit.author_name,
                author_email: &commit.author_email,
                author_date: Some(&commit.author_date),
                committer_name,
                committer_email,
                message: &replayed_commit_message(&commit.message)?,
            },
        )
        .await?;
        tip_tree_sha = replayed_tree_sha;
    }

    // Every commit replayed to nothing, so there is no commit to move the target
    // to. Leaving the target where it is would be a merge that merged nothing.
    if tip_sha == base_sha {
        return Ok(RebaseReplay::Unavailable(
            RepositoryMergeStrategyUnavailableReason::NothingToRebase,
        ));
    }

    Ok(RebaseReplay::Replayed(tip_sha))
}

async fn list_source_commits(
    storage: &RepositoryStorage,
    repository_path: &Path,
    base_sha: &str,
    head_sha: &str,
) -> Result<Vec<SourceCommit>, RepositoryError> {
    let range = format!("{base_sha}..{head_sha}");
    let max_count = format!("--max-count={}", REBASE_COMMIT_LIMIT + 1);
    let output = storage
        .git(
            repository_path,
            [
                "log",
                "--reverse",
                "--topo-order",
                "--no-merges",
                &max_count,
                "--format=format:%H%x00%P%x00%an%x00%ae%x00%aI%x00%B%x1e",
                &range,
                "--",
            ],
        )
        .await?;

    if !output.status.success() {
        return Err(RepositoryError::GitProcessFailed);
    }

    parse_source_commits(&output.stdout)
}

fn parse_source_commits(output: &[u8]) -> Result<Vec<SourceCommit>, RepositoryError> {
    output
        .split(|byte| *byte == RECORD_SEPARATOR)
        .filter(|record| !record.is_empty() && *record != b"\n")
        .map(|record| {
            let record = record.strip_prefix(b"\n").unwrap_or(record);
            let fields: Vec<&[u8]> = record.splitn(6, |byte| *byte == FIELD_SEPARATOR).collect();

            if fields.len() != 6 {
                return Err(RepositoryError::InvalidGitOutput);
            }

            Ok(SourceCommit {
                sha: utf8(fields[0])?,
                // The first parent is the one the commit's own changes are
                // relative to. A root commit lists none, and there is no diff to
                // replay from it.
                parent_sha: utf8(fields[1])?
                    .split_whitespace()
                    .next()
                    .map(str::to_string),
                author_name: utf8(fields[2])?,
                author_email: utf8(fields[3])?,
                author_date: utf8(fields[4])?,
                message: fields[5].to_vec(),
            })
        })
        .collect()
}

fn first_line(stdout: &[u8]) -> Result<String, RepositoryError> {
    let value = utf8_trimmed(stdout)?
        .lines()
        .next()
        .ok_or(RepositoryError::InvalidGitOutput)?
        .to_string();

    if value.is_empty() {
        return Err(RepositoryError::InvalidGitOutput);
    }

    Ok(value)
}

fn utf8(value: &[u8]) -> Result<String, RepositoryError> {
    String::from_utf8(value.to_vec()).map_err(|_| RepositoryError::InvalidGitOutput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_commits_whose_messages_span_lines() {
        let output =
            b"aaa\x00bbb ccc\x00Ada\x00ada@example.com\x002024-01-01T00:00:00+00:00\x00Subject\n\nBody\n\x1e";

        let commits = parse_source_commits(output).unwrap();

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].sha, "aaa");
        assert_eq!(commits[0].parent_sha.as_deref(), Some("bbb"));
        assert_eq!(commits[0].author_name, "Ada");
        assert_eq!(commits[0].message, b"Subject\n\nBody\n");
    }

    #[test]
    fn a_root_commit_reports_no_parent_to_replay_from() {
        let output =
            b"aaa\x00\x00Ada\x00ada@example.com\x002024-01-01T00:00:00+00:00\x00Subject\n\x1e";

        let commits = parse_source_commits(output).unwrap();

        assert_eq!(commits[0].parent_sha, None);
    }

    #[test]
    fn an_empty_range_replays_nothing() {
        assert!(parse_source_commits(b"").unwrap().is_empty());
    }
}
