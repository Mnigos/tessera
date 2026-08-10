use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tokio::time::Duration;

use crate::domain::RepositoryError;
use crate::storage::infrastructure::repository_browser::GitCommandOptions;
use crate::storage::infrastructure::repository_ref_helpers::{
    qualified_branch_ref, resolve_commit_ref, utf8_trimmed,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

pub(super) const MERGE_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// Where Git should put the objects a command writes.
///
/// A merge writes into the repository, because its objects are what the target
/// branch will point at. An availability check writes into a scratch store that
/// is deleted afterwards: it answers a question, and a question must not leave
/// unreachable objects behind in a repository every pull request page asks it
/// about.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct ObjectStore<'a> {
    scratch_path: Option<&'a Path>,
}

impl<'a> ObjectStore<'a> {
    pub(super) fn repository() -> Self {
        Self { scratch_path: None }
    }

    pub(super) fn scratch(scratch_path: &'a Path) -> Self {
        Self {
            scratch_path: Some(scratch_path),
        }
    }

    /// Points Git's writes at the scratch store while leaving the repository's
    /// own objects readable through it.
    fn environment(self, repository_path: &Path) -> Vec<(&'static str, OsString)> {
        let Some(scratch_path) = self.scratch_path else {
            return Vec::new();
        };

        vec![
            ("GIT_OBJECT_DIRECTORY", scratch_path.into()),
            (
                "GIT_ALTERNATE_OBJECT_DIRECTORIES",
                repository_path.join("objects").into(),
            ),
        ]
    }
}

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

/// One commit to write. Author and committer are separate because a rebase
/// keeps the original author — name, address and date — and records the person
/// who merged as the committer, exactly as `git rebase` does.
pub(super) struct CommitTreeRequest<'a> {
    pub tree_sha: &'a str,
    pub parents: &'a [&'a str],
    pub author_name: &'a str,
    pub author_email: &'a str,
    /// Absent lets Git stamp the current time, which is what an authored merge
    /// or squash commit wants.
    pub author_date: Option<&'a str>,
    pub committer_name: &'a str,
    pub committer_email: &'a str,
    /// Bytes rather than text: a replayed commit keeps the message the author
    /// wrote, and Git does not require it to be UTF-8.
    pub message: &'a [u8],
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
    objects: ObjectStore<'_>,
    args: [&str; N],
) -> Result<MergeTreeOutcome, RepositoryError> {
    let output = storage
        .git_command(
            repository_path,
            args,
            GitCommandOptions {
                environment: &objects.environment(repository_path),
                timeout: MERGE_COMMAND_TIMEOUT,
                ..GitCommandOptions::default()
            },
        )
        .await?;

    if output.status.success() {
        return Ok(MergeTreeOutcome::Clean(output.stdout));
    }

    match output.status.code() {
        Some(1) => Ok(MergeTreeOutcome::Conflicted(output.stdout)),
        _ => Err(RepositoryError::GitProcessFailed),
    }
}

/// The tree `git merge-tree --write-tree` produced, which every strategy that
/// combines two tips commits as-is.
pub(super) async fn write_merge_tree(
    storage: &RepositoryStorage,
    repository_path: &Path,
    base_sha: &str,
    head_sha: &str,
) -> Result<String, RepositoryError> {
    let stdout = match run_merge_tree(
        storage,
        repository_path,
        ObjectStore::repository(),
        [
            "merge-tree",
            "--write-tree",
            "--messages",
            base_sha,
            head_sha,
        ],
    )
    .await?
    {
        MergeTreeOutcome::Clean(stdout) => stdout,
        MergeTreeOutcome::Conflicted(_) => return Err(RepositoryError::MergeConflict),
    };
    let tree_sha = utf8_trimmed(&stdout)?
        .lines()
        .next()
        .ok_or(RepositoryError::InvalidGitOutput)?
        .to_string();

    if tree_sha.is_empty() {
        return Err(RepositoryError::InvalidGitOutput);
    }

    Ok(tree_sha)
}

pub(super) async fn resolve_commit_tree(
    storage: &RepositoryStorage,
    repository_path: &Path,
    commit_sha: &str,
) -> Result<String, RepositoryError> {
    let tree_ref = format!("{commit_sha}^{{tree}}");
    let output = storage
        .git(
            repository_path,
            ["rev-parse", "--verify", "--end-of-options", &tree_ref],
        )
        .await?;

    if !output.status.success() {
        return Err(RepositoryError::RepositoryObjectNotFound);
    }

    let tree_sha = utf8_trimmed(&output.stdout)?;
    if tree_sha.is_empty() {
        return Err(RepositoryError::InvalidGitOutput);
    }

    Ok(tree_sha)
}

pub(super) async fn is_ancestor(
    storage: &RepositoryStorage,
    repository_path: &Path,
    ancestor_sha: &str,
    descendant_sha: &str,
) -> Result<bool, RepositoryError> {
    let output = storage
        .git(
            repository_path,
            ["merge-base", "--is-ancestor", ancestor_sha, descendant_sha],
        )
        .await?;

    match output.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(RepositoryError::GitProcessFailed),
    }
}

/// Writes one commit object. The message goes in over stdin rather than as an
/// argument: pull request bodies run to tens of kilobytes, and an argument list
/// has a limit a commit message does not.
pub(super) async fn create_commit(
    storage: &RepositoryStorage,
    repository_path: &Path,
    objects: ObjectStore<'_>,
    request: CommitTreeRequest<'_>,
) -> Result<String, RepositoryError> {
    let mut arguments = vec!["commit-tree".to_string(), request.tree_sha.to_string()];

    for parent in request.parents {
        arguments.push("-p".to_string());
        arguments.push((*parent).to_string());
    }

    // Reading the message from stdin rather than an argument, which has a
    // length limit a commit message does not.
    arguments.push("-F".to_string());
    arguments.push("-".to_string());

    let mut environment = objects.environment(repository_path);
    environment.extend([
        ("GIT_AUTHOR_NAME", request.author_name.into()),
        ("GIT_AUTHOR_EMAIL", request.author_email.into()),
        ("GIT_COMMITTER_NAME", request.committer_name.into()),
        ("GIT_COMMITTER_EMAIL", request.committer_email.into()),
    ]);

    if let Some(author_date) = request.author_date {
        environment.push(("GIT_AUTHOR_DATE", author_date.into()));
    }

    let output = storage
        .git_command(
            repository_path,
            &arguments,
            GitCommandOptions {
                environment: &environment,
                input: Some(request.message),
                timeout: MERGE_COMMAND_TIMEOUT,
            },
        )
        .await?;

    if !output.status.success() {
        tracing::warn!(
            stderr = %String::from_utf8_lossy(&output.stderr).trim(),
            "git commit-tree failed"
        );

        return Err(RepositoryError::GitProcessFailed);
    }

    let commit_sha = utf8_trimmed(&output.stdout)?;
    if commit_sha.is_empty() {
        return Err(RepositoryError::InvalidGitOutput);
    }

    Ok(commit_sha)
}
