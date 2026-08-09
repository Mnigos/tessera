use std::path::Path;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{
    RepositoryError, RepositoryMerge, RepositoryMergeRequest, RepositoryMergeStrategy,
    RepositoryMergeStrategyUnavailableReason,
};
use crate::storage::infrastructure::repository_browser_helpers::validate_object_id;
use crate::storage::infrastructure::repository_merge_helpers::{
    CommitTreeRequest, MERGE_COMMAND_TIMEOUT, ObjectStore, ResolvedMergeRefs, create_commit,
    is_ancestor, resolve_merge_refs, write_merge_tree,
};
use crate::storage::infrastructure::repository_merge_message::{
    OPERATION_TRAILER_NAME, merge_commit_message, squash_commit_message,
};
use crate::storage::infrastructure::repository_merge_rebase::{
    RebaseReplay, replay_source_commits,
};
use crate::storage::infrastructure::repository_merge_receipt::{
    MergeReceipt, operation_ref, validate_operation_id,
};
use crate::storage::infrastructure::repository_ref_helpers::resolve_commit_ref;
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

/// How long one merge may take end to end, rebase replay included.
///
/// This has to stay below the API's own merge RPC deadline, which in turn stays
/// below the merge intent lease: the innermost timeout must fire first, so a
/// merge that overruns is refused by Git rather than abandoned mid-flight by a
/// caller that has already given up on it. At the measured replay cost of about
/// thirty milliseconds per commit, this leaves a bounded rebase an order of
/// magnitude more room than it needs.
pub const MERGE_OPERATION_TIMEOUT: Duration = Duration::from_secs(45);

/// How far back a pre-receipt merge is looked for. Bounds the walk rather than
/// the matches, so an operation that is not there costs a fixed read instead of
/// a whole history.
const LEGACY_SCAN_COMMIT_LIMIT: usize = 400;

impl RepositoryStorage {
    pub async fn merge_repository_refs(
        &self,
        request: RepositoryMergeRequest<'_>,
    ) -> Result<RepositoryMerge, RepositoryError> {
        timeout(
            MERGE_OPERATION_TIMEOUT,
            self.merge_repository_refs_inner(request),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
    }

    /// Merges by whichever strategy was asked for, exactly once.
    ///
    /// Every path through here builds all of its objects before touching a ref,
    /// and then moves the target and files the operation receipt in one Git
    /// transaction. The receipt is the whole idempotency story: this operation
    /// having already moved the target is the only thing that turns a retry into
    /// a success, and finding the target somewhere else with no receipt of ours
    /// is staleness no matter how plausible the commit looks.
    async fn merge_repository_refs_inner(
        &self,
        request: RepositoryMergeRequest<'_>,
    ) -> Result<RepositoryMerge, RepositoryError> {
        validate_merge_input(&request)?;
        validate_object_id(request.expected_base_sha)?;
        validate_object_id(request.expected_head_sha)?;
        let ResolvedMergeRefs {
            repository_path,
            base_ref,
            head_ref,
            base_sha: current_base_sha,
            head_sha: current_head_sha,
        } = resolve_merge_refs(
            self,
            request.repository_id,
            request.storage_path,
            request.base_ref,
            request.head_ref,
        )
        .await?;

        if let Some(resulting_sha) = self
            .completed_merge_for_operation(&repository_path, &current_base_sha, &request)
            .await?
        {
            return Ok(RepositoryMerge { resulting_sha });
        }

        if current_base_sha != request.expected_base_sha
            || current_head_sha != request.expected_head_sha
        {
            return Err(RepositoryError::StaleRepositoryRef);
        }

        let resulting_sha = self.build_merge_result(&repository_path, &request).await?;
        let receipt = MergeReceipt {
            strategy: request.strategy,
            base_sha: request.expected_base_sha.to_string(),
            head_sha: request.expected_head_sha.to_string(),
            resulting_sha: resulting_sha.clone(),
        };
        let receipt_sha = self
            .create_merge_receipt(&repository_path, &receipt, request.operation_id)
            .await?;
        let update_result = self
            .update_merge_refs(
                &repository_path,
                MergeRefUpdate {
                    base_ref: &base_ref,
                    head_ref: &head_ref,
                    expected_base_sha: request.expected_base_sha,
                    expected_head_sha: request.expected_head_sha,
                    resulting_sha: &resulting_sha,
                    operation_ref: &operation_ref(request.operation_id),
                    receipt_sha: &receipt_sha,
                },
            )
            .await;

        if let Err(error) = update_result {
            // The transaction is all-or-nothing, so a failure here means either
            // that nothing moved or that this attempt lost a race to a twin of
            // itself. Only a receipt can tell those apart, and only a receipt
            // makes it safe to report success.
            let current_base_sha = resolve_commit_ref(self, &repository_path, &base_ref).await?;

            if let Some(resulting_sha) = self
                .completed_merge_for_operation(&repository_path, &current_base_sha, &request)
                .await?
            {
                return Ok(RepositoryMerge { resulting_sha });
            }

            return Err(error);
        }

        Ok(RepositoryMerge { resulting_sha })
    }

    /// Whether this operation already merged, without merging.
    ///
    /// A caller that lost the answer to a merge it started needs to tell two
    /// situations apart: Git performed the merge and the caller failed to record
    /// it, or Git never performed it at all. Only the first may be recorded after
    /// the fact; the second is a merge that still has to be decided on its
    /// merits. Nothing here writes an object or moves a ref, so asking is always
    /// safe.
    pub async fn find_repository_merge_receipt(
        &self,
        repository_id: &str,
        storage_path: &str,
        operation_id: &str,
        strategy: RepositoryMergeStrategy,
        expected_base_sha: &str,
        expected_head_sha: &str,
    ) -> Result<Option<String>, RepositoryError> {
        validate_operation_id(operation_id)?;
        validate_object_id(expected_base_sha)?;
        validate_object_id(expected_head_sha)?;
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let Some(receipt) = self
            .read_merge_receipt(&repository_path, operation_id)
            .await?
        else {
            return Ok(None);
        };

        // A receipt describing other tips belongs to some other merge that
        // happens to share an identifier, and reporting its result would record
        // commits this caller never asked for.
        if receipt.strategy != strategy
            || receipt.base_sha != expected_base_sha
            || receipt.head_sha != expected_head_sha
        {
            return Ok(None);
        }

        Ok(Some(receipt.resulting_sha))
    }

    /// What this operation already did, if anything.
    ///
    /// The receipt answers for every strategy and is checked against the request
    /// before it is believed: a receipt recording other tips describes a
    /// different merge that happens to share an identifier, and reporting its
    /// result would attribute the wrong commits to this attempt.
    async fn completed_merge_for_operation(
        &self,
        repository_path: &Path,
        current_base_sha: &str,
        request: &RepositoryMergeRequest<'_>,
    ) -> Result<Option<String>, RepositoryError> {
        if let Some(receipt) = self
            .read_merge_receipt(repository_path, request.operation_id)
            .await?
        {
            if receipt.strategy != request.strategy
                || receipt.base_sha != request.expected_base_sha
                || receipt.head_sha != request.expected_head_sha
            {
                return Err(RepositoryError::StaleRepositoryRef);
            }

            return Ok(Some(receipt.resulting_sha));
        }

        // Merges made before receipts existed left only the trailer on the merge
        // commit itself. It proves nothing about who wrote the commit, which is
        // why it is reached only when no receipt exists and only for the one
        // strategy that ever wrote it.
        //
        // It is also skipped whenever the target is still where this request
        // expects it, which is the overwhelmingly common case. A merge of ours
        // that already landed would have moved the target; a target that has not
        // moved cannot be hiding one. That turns an unbounded history scan on
        // every merge into one that runs only when a previous attempt might
        // actually have completed.
        if request.strategy != RepositoryMergeStrategy::MergeCommit
            || current_base_sha == request.expected_base_sha
        {
            return Ok(None);
        }

        self.legacy_merge_for_operation(
            repository_path,
            current_base_sha,
            request.expected_head_sha,
            request.operation_id,
        )
        .await
    }

    /// A pre-receipt merge of this operation, found by reading a bounded window
    /// of the target's own history.
    ///
    /// `--grep` would be the obvious way to ask, but it bounds the number of
    /// matches rather than the number of commits walked: an operation that is not
    /// there sends Git through the entire first-parent history while this call
    /// holds the repository's merge lease. So a fixed window is enumerated
    /// instead and its messages are read here. A merge older than the window is
    /// treated as absent, which is safe in the direction that matters — the
    /// caller falls through to a fresh merge, and the target compare-and-swap
    /// still refuses it if the world moved.
    async fn legacy_merge_for_operation(
        &self,
        repository_path: &Path,
        current_base_sha: &str,
        expected_head_sha: &str,
        operation_id: &str,
    ) -> Result<Option<String>, RepositoryError> {
        let operation_trailer = format!("{OPERATION_TRAILER_NAME}: {operation_id}");
        let max_count = format!("--max-count={LEGACY_SCAN_COMMIT_LIMIT}");
        let output = self
            .git(
                repository_path,
                [
                    "log",
                    "--first-parent",
                    &max_count,
                    "--format=format:%H%x00%P%x00%B%x1e",
                    current_base_sha,
                    "--",
                ],
            )
            .await?;

        if !output.status.success() {
            return Ok(None);
        }

        let text =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;

        for record in text.split('\u{1e}') {
            let record = record.trim_start_matches('\n');
            if record.is_empty() {
                continue;
            }

            let mut fields = record.splitn(3, '\0');
            let sha = fields
                .next()
                .ok_or(RepositoryError::InvalidGitOutput)?
                .trim();
            let parents = fields.next().ok_or(RepositoryError::InvalidGitOutput)?;
            let body = fields.next().ok_or(RepositoryError::InvalidGitOutput)?;

            // The source head being a parent is what separates a merge this
            // operation made from a commit whose message merely quotes the
            // trailer, which anybody who can push may write.
            if parents
                .split_whitespace()
                .any(|parent| parent == expected_head_sha)
                && body.lines().any(|line| line.trim() == operation_trailer)
            {
                return Ok(Some(sha.to_string()));
            }
        }

        Ok(None)
    }

    /// The commit the target has to be moved to, built and written but not yet
    /// pointed at by anything.
    async fn build_merge_result(
        &self,
        repository_path: &Path,
        request: &RepositoryMergeRequest<'_>,
    ) -> Result<String, RepositoryError> {
        match request.strategy {
            RepositoryMergeStrategy::MergeCommit => {
                let tree_sha = write_merge_tree(
                    self,
                    repository_path,
                    request.expected_base_sha,
                    request.expected_head_sha,
                )
                .await?;

                self.create_authored_commit(
                    repository_path,
                    request,
                    &tree_sha,
                    &[request.expected_base_sha, request.expected_head_sha],
                    &merge_commit_message(request.message, request.operation_id)?,
                )
                .await
            }
            // The tree is the merge's, not the source head's, so independent work
            // already on the target survives being squashed onto.
            RepositoryMergeStrategy::Squash => {
                let tree_sha = write_merge_tree(
                    self,
                    repository_path,
                    request.expected_base_sha,
                    request.expected_head_sha,
                )
                .await?;

                self.create_authored_commit(
                    repository_path,
                    request,
                    &tree_sha,
                    &[request.expected_base_sha],
                    &squash_commit_message(
                        request.squash_title,
                        request.squash_body,
                        request.operation_id,
                    )?,
                )
                .await
            }
            RepositoryMergeStrategy::FastForward => {
                self.resolve_fast_forward(repository_path, request).await
            }
            RepositoryMergeStrategy::Rebase => {
                match replay_source_commits(
                    self,
                    repository_path,
                    ObjectStore::repository(),
                    request.expected_base_sha,
                    request.expected_head_sha,
                    request.author_name,
                    request.author_email,
                )
                .await?
                {
                    RebaseReplay::Replayed(resulting_sha) => Ok(resulting_sha),
                    RebaseReplay::Unavailable(
                        RepositoryMergeStrategyUnavailableReason::Conflict,
                    ) => Err(RepositoryError::MergeConflict),
                    RebaseReplay::Unavailable(reason) => {
                        Err(RepositoryError::MergeStrategyUnavailable(reason))
                    }
                }
            }
        }
    }

    /// A fast-forward writes no object at all: the target is moved onto the
    /// source head. Equal tips are reported as already up to date rather than as
    /// an advance to where the branch already is.
    async fn resolve_fast_forward(
        &self,
        repository_path: &Path,
        request: &RepositoryMergeRequest<'_>,
    ) -> Result<String, RepositoryError> {
        if request.expected_base_sha == request.expected_head_sha {
            return Err(RepositoryError::MergeStrategyUnavailable(
                RepositoryMergeStrategyUnavailableReason::AlreadyUpToDate,
            ));
        }

        if !is_ancestor(
            self,
            repository_path,
            request.expected_base_sha,
            request.expected_head_sha,
        )
        .await?
        {
            return Err(RepositoryError::MergeStrategyUnavailable(
                RepositoryMergeStrategyUnavailableReason::NotFastForward,
            ));
        }

        Ok(request.expected_head_sha.to_string())
    }

    async fn create_authored_commit(
        &self,
        repository_path: &Path,
        request: &RepositoryMergeRequest<'_>,
        tree_sha: &str,
        parents: &[&str],
        message: &str,
    ) -> Result<String, RepositoryError> {
        create_commit(
            self,
            repository_path,
            ObjectStore::repository(),
            CommitTreeRequest {
                tree_sha,
                parents,
                author_name: request.author_name,
                author_email: request.author_email,
                author_date: None,
                committer_name: request.author_name,
                committer_email: request.author_email,
                message: message.as_bytes(),
            },
        )
        .await
    }

    /// Moves the target and files the receipt, or does neither.
    ///
    /// `create` refuses a receipt that already exists, so two attempts sharing an
    /// operation identifier cannot both move the target: the loser's whole
    /// transaction is rejected and it goes on to read the winner's receipt.
    async fn update_merge_refs(
        &self,
        repository_path: &Path,
        update: MergeRefUpdate<'_>,
    ) -> Result<(), RepositoryError> {
        let MergeRefUpdate {
            base_ref,
            head_ref,
            expected_base_sha,
            expected_head_sha,
            resulting_sha,
            operation_ref,
            receipt_sha,
        } = update;
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
            "start\nverify {head_ref} {expected_head_sha}\nupdate {base_ref} {resulting_sha} {expected_base_sha}\ncreate {operation_ref} {receipt_sha}\nprepare\ncommit\n"
        );
        let mut stdin = child
            .stdin
            .take()
            .ok_or(RepositoryError::GitProcessFailed)?;
        let write_result = stdin.write_all(transaction.as_bytes()).await;
        drop(stdin);
        let output = timeout(MERGE_COMMAND_TIMEOUT, child.wait_with_output())
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

struct MergeRefUpdate<'a> {
    base_ref: &'a str,
    head_ref: &'a str,
    expected_base_sha: &'a str,
    expected_head_sha: &'a str,
    resulting_sha: &'a str,
    operation_ref: &'a str,
    receipt_sha: &'a str,
}

fn resolved_ref_changed(current_sha: &Result<String, RepositoryError>, expected_sha: &str) -> bool {
    match current_sha {
        Ok(current_sha) => current_sha != expected_sha,
        Err(RepositoryError::InvalidRepositoryRef) => true,
        Err(_) => false,
    }
}

fn validate_merge_input(request: &RepositoryMergeRequest<'_>) -> Result<(), RepositoryError> {
    validate_operation_id(request.operation_id)?;

    if request.author_name.trim().is_empty()
        || request.author_email.trim().is_empty()
        || [request.author_name, request.author_email]
            .iter()
            .any(|value| value.contains('\0') || value.contains('\r') || value.contains('\n'))
    {
        return Err(RepositoryError::InvalidMergeInput);
    }

    // The message fields are only validated for the strategy that writes them;
    // the others are handed whatever the caller left in the request and must not
    // refuse a merge over text nothing will read.
    match request.strategy {
        RepositoryMergeStrategy::MergeCommit => {
            merge_commit_message(request.message, request.operation_id)?;
        }
        RepositoryMergeStrategy::Squash => {
            squash_commit_message(
                request.squash_title,
                request.squash_body,
                request.operation_id,
            )?;
        }
        RepositoryMergeStrategy::Rebase | RepositoryMergeStrategy::FastForward => {}
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::infrastructure::repository_mergeability::MERGEABILITY_OPERATION_TIMEOUT;

    /// The API's own merge deadline, mirrored from `MERGE_RPC_TIMEOUT_MS` in
    /// `apps/api`. That side asserts the same two values against these, so a
    /// change to either fails on both.
    const API_MERGE_RPC_TIMEOUT: Duration = Duration::from_secs(50);

    // Git storage gives up before the caller waiting on it does. Otherwise an
    // overrunning merge is abandoned by a caller that has already stopped
    // listening, while Git carries on and moves the target anyway.
    #[test]
    fn git_gives_up_before_the_api_stops_waiting() {
        assert!(MERGE_OPERATION_TIMEOUT < API_MERGE_RPC_TIMEOUT);
        assert!(MERGEABILITY_OPERATION_TIMEOUT <= API_MERGE_RPC_TIMEOUT);
    }

    const BASE_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const HEAD_SHA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    fn request(strategy: RepositoryMergeStrategy) -> RepositoryMergeRequest<'static> {
        RepositoryMergeRequest {
            repository_id: "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5",
            storage_path: "/tmp/repositories/018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5.git",
            base_ref: "main",
            head_ref: "feature",
            expected_base_sha: BASE_SHA,
            expected_head_sha: HEAD_SHA,
            author_name: "Ada",
            author_email: "ada@example.com",
            message: "Merge pull request #1",
            squash_title: "Add search (#1)",
            squash_body: "",
            strategy,
            operation_id: "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5",
        }
    }

    #[test]
    fn merge_input_rejects_newline_in_identity() {
        let mut invalid = request(RepositoryMergeStrategy::MergeCommit);
        invalid.author_name = "Ada\nBot";

        assert!(matches!(
            validate_merge_input(&invalid),
            Err(RepositoryError::InvalidMergeInput)
        ));
    }

    #[test]
    fn merge_input_rejects_an_operation_id_that_is_not_a_uuid() {
        let mut invalid = request(RepositoryMergeStrategy::MergeCommit);
        invalid.operation_id = "pr-1";

        assert!(matches!(
            validate_merge_input(&invalid),
            Err(RepositoryError::InvalidMergeInput)
        ));
    }

    #[test]
    fn merge_input_only_judges_the_text_its_strategy_writes() {
        let mut without_message = request(RepositoryMergeStrategy::FastForward);
        without_message.message = "";
        without_message.squash_title = "";

        assert!(validate_merge_input(&without_message).is_ok());

        let mut squash_without_title = request(RepositoryMergeStrategy::Squash);
        squash_without_title.squash_title = "   ";

        assert!(matches!(
            validate_merge_input(&squash_without_title),
            Err(RepositoryError::InvalidMergeInput)
        ));
    }

    #[test]
    fn merge_input_accepts_safe_values() {
        assert!(validate_merge_input(&request(RepositoryMergeStrategy::MergeCommit)).is_ok());
        assert!(validate_merge_input(&request(RepositoryMergeStrategy::Squash)).is_ok());
        assert!(validate_merge_input(&request(RepositoryMergeStrategy::Rebase)).is_ok());
    }
}
