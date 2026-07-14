use std::path::Path;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{RepositoryError, RepositoryMerge};
use crate::storage::infrastructure::repository_browser_helpers::validate_object_id;
use crate::storage::infrastructure::repository_ref_helpers::{
    qualified_branch_ref, resolve_commit_ref, utf8_trimmed,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const MERGE_TIMEOUT: Duration = Duration::from_secs(30);
const MERGE_OPERATION_TIMEOUT: Duration = Duration::from_secs(45);

impl RepositoryStorage {
    #[allow(clippy::too_many_arguments)]
    pub async fn merge_repository_refs(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
        expected_base_sha: &str,
        expected_head_sha: &str,
        author_name: &str,
        author_email: &str,
        message: &str,
        operation_id: &str,
    ) -> Result<RepositoryMerge, RepositoryError> {
        timeout(
            MERGE_OPERATION_TIMEOUT,
            self.merge_repository_refs_inner(
                repository_id,
                storage_path,
                base_ref,
                head_ref,
                expected_base_sha,
                expected_head_sha,
                author_name,
                author_email,
                message,
                operation_id,
            ),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
    }

    #[allow(clippy::too_many_arguments)]
    async fn merge_repository_refs_inner(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
        expected_base_sha: &str,
        expected_head_sha: &str,
        author_name: &str,
        author_email: &str,
        message: &str,
        operation_id: &str,
    ) -> Result<RepositoryMerge, RepositoryError> {
        validate_merge_input(author_name, author_email, message, operation_id)?;
        validate_object_id(expected_base_sha)?;
        validate_object_id(expected_head_sha)?;
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let base_ref = qualified_branch_ref(base_ref)?;
        let head_ref = qualified_branch_ref(head_ref)?;
        let current_base_sha = resolve_commit_ref(self, &repository_path, &base_ref).await?;
        let current_head_sha = resolve_commit_ref(self, &repository_path, &head_ref).await?;
        if let Some(merge_commit_sha) = self
            .existing_merge_for_operation(
                &repository_path,
                &current_base_sha,
                expected_head_sha,
                operation_id,
            )
            .await?
        {
            return Ok(RepositoryMerge { merge_commit_sha });
        }

        if current_base_sha != expected_base_sha || current_head_sha != expected_head_sha {
            return Err(RepositoryError::StaleRepositoryRef);
        }

        let tree_sha = self
            .create_merge_tree(&repository_path, expected_base_sha, expected_head_sha)
            .await?;
        let commit_message = format!("{message}\n\nTessera-Operation: {operation_id}\n");
        let merge_commit_sha = self
            .create_merge_commit(
                &repository_path,
                &tree_sha,
                expected_base_sha,
                expected_head_sha,
                author_name,
                author_email,
                &commit_message,
            )
            .await?;

        let update_result = self
            .update_merge_refs(
                &repository_path,
                &base_ref,
                &head_ref,
                expected_base_sha,
                expected_head_sha,
                &merge_commit_sha,
            )
            .await;
        if let Err(error) = update_result {
            if matches!(error, RepositoryError::StaleRepositoryRef) {
                let current_base_sha =
                    resolve_commit_ref(self, &repository_path, &base_ref).await?;
                if let Some(existing_merge_sha) = self
                    .existing_merge_for_operation(
                        &repository_path,
                        &current_base_sha,
                        expected_head_sha,
                        operation_id,
                    )
                    .await?
                {
                    return Ok(RepositoryMerge {
                        merge_commit_sha: existing_merge_sha,
                    });
                }
            }

            return Err(error);
        }

        Ok(RepositoryMerge { merge_commit_sha })
    }

    async fn existing_merge_for_operation(
        &self,
        repository_path: &Path,
        current_base_sha: &str,
        expected_head_sha: &str,
        operation_id: &str,
    ) -> Result<Option<String>, RepositoryError> {
        let operation_trailer = format!("Tessera-Operation: {operation_id}");
        let grep = format!("--grep={operation_trailer}");
        let output = self
            .git(
                repository_path,
                [
                    "log",
                    "--first-parent",
                    "--max-count=1",
                    "--fixed-strings",
                    &grep,
                    "--format=%H%x00%P%x00%B",
                    current_base_sha,
                    "--",
                ],
            )
            .await?;

        if !output.status.success() {
            return Ok(None);
        }
        if output.stdout.is_empty() {
            return Ok(None);
        }

        let text =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;
        let mut fields = text.splitn(3, '\0');
        let sha = fields
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?
            .trim();
        let parents = fields.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let body = fields.next().ok_or(RepositoryError::InvalidGitOutput)?;
        if parents
            .split_whitespace()
            .any(|parent| parent == expected_head_sha)
            && body.lines().any(|line| line.trim() == operation_trailer)
        {
            return Ok(Some(sha.to_string()));
        }

        Ok(None)
    }

    async fn create_merge_tree(
        &self,
        repository_path: &Path,
        base_sha: &str,
        head_sha: &str,
    ) -> Result<String, RepositoryError> {
        let output = self
            .git(
                repository_path,
                [
                    "merge-tree",
                    "--write-tree",
                    "--messages",
                    base_sha,
                    head_sha,
                ],
            )
            .await?;

        if !output.status.success() {
            return match output.status.code() {
                Some(1) => Err(RepositoryError::MergeConflict),
                _ => Err(RepositoryError::GitProcessFailed),
            };
        }

        let tree_sha = utf8_trimmed(&output.stdout)?
            .lines()
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?
            .to_string();
        if tree_sha.is_empty() {
            return Err(RepositoryError::InvalidGitOutput);
        }

        Ok(tree_sha)
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_merge_commit(
        &self,
        repository_path: &Path,
        tree_sha: &str,
        base_sha: &str,
        head_sha: &str,
        author_name: &str,
        author_email: &str,
        message: &str,
    ) -> Result<String, RepositoryError> {
        let output = timeout(
            MERGE_TIMEOUT,
            Command::new(&self.git_binary)
                .arg("--git-dir")
                .arg(repository_path)
                .arg("commit-tree")
                .arg(tree_sha)
                .arg("-p")
                .arg(base_sha)
                .arg("-p")
                .arg(head_sha)
                .arg("-m")
                .arg(message)
                .env("GIT_AUTHOR_NAME", author_name)
                .env("GIT_AUTHOR_EMAIL", author_email)
                .env("GIT_COMMITTER_NAME", author_name)
                .env("GIT_COMMITTER_EMAIL", author_email)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
        .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        utf8_trimmed(&output.stdout)
    }

    #[allow(clippy::too_many_arguments)]
    async fn update_merge_refs(
        &self,
        repository_path: &Path,
        base_ref: &str,
        head_ref: &str,
        expected_base_sha: &str,
        expected_head_sha: &str,
        merge_commit_sha: &str,
    ) -> Result<(), RepositoryError> {
        let mut child = Command::new(&self.git_binary)
            .arg("--git-dir")
            .arg(repository_path)
            .arg("update-ref")
            .arg("--stdin")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(RepositoryError::GitProcessIo)?;
        let transaction = format!(
            "start\nverify {head_ref} {expected_head_sha}\nupdate {base_ref} {merge_commit_sha} {expected_base_sha}\nprepare\ncommit\n"
        );
        let mut stdin = child
            .stdin
            .take()
            .ok_or(RepositoryError::GitProcessFailed)?;
        let write_result = stdin.write_all(transaction.as_bytes()).await;
        drop(stdin);
        let output = timeout(MERGE_TIMEOUT, child.wait_with_output())
            .await
            .map_err(|_| RepositoryError::GitProcessFailed)?
            .map_err(RepositoryError::GitProcessIo)?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(
                base_ref,
                head_ref,
                stderr = %stderr.trim(),
                "git update-ref failed"
            );
            let current_base_sha = resolve_commit_ref(self, repository_path, base_ref).await;
            let current_head_sha = resolve_commit_ref(self, repository_path, head_ref).await;
            let base_changed = resolved_ref_changed(&current_base_sha, expected_base_sha);
            let head_changed = resolved_ref_changed(&current_head_sha, expected_head_sha);

            return if base_changed || head_changed {
                Err(RepositoryError::StaleRepositoryRef)
            } else {
                Err(RepositoryError::GitProcessFailed)
            };
        }

        write_result.map_err(RepositoryError::GitProcessIo)?;

        Ok(())
    }
}

fn resolved_ref_changed(current_sha: &Result<String, RepositoryError>, expected_sha: &str) -> bool {
    match current_sha {
        Ok(current_sha) => current_sha != expected_sha,
        Err(RepositoryError::InvalidRepositoryRef) => true,
        Err(_) => false,
    }
}

fn validate_merge_input(
    author_name: &str,
    author_email: &str,
    message: &str,
    operation_id: &str,
) -> Result<(), RepositoryError> {
    if author_name.trim().is_empty()
        || author_email.trim().is_empty()
        || message.trim().is_empty()
        || operation_id.trim().is_empty()
        || [author_name, author_email, message, operation_id]
            .iter()
            .any(|value| value.contains('\0') || value.contains('\r'))
        || author_name.contains('\n')
        || author_email.contains('\n')
        || operation_id.contains('\n')
    {
        return Err(RepositoryError::InvalidMergeInput);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_input_rejects_newline_in_identity() {
        assert!(matches!(
            validate_merge_input("Ada\nBot", "ada@example.com", "Merge", "pr-1"),
            Err(RepositoryError::InvalidMergeInput)
        ));
    }

    #[test]
    fn merge_input_accepts_safe_values() {
        assert!(validate_merge_input("Ada", "ada@example.com", "Merge branch", "pr-1").is_ok());
    }
}
