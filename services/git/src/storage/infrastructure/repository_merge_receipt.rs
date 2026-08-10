use std::path::Path;

use crate::domain::repository::TESSERA_REF_NAMESPACE;
use crate::domain::{RepositoryError, RepositoryMergeStrategy};
use crate::storage::infrastructure::repository_merge_helpers::{
    CommitTreeRequest, ObjectStore, create_commit, resolve_commit_tree,
};
use crate::storage::infrastructure::repository_merge_message::OPERATION_TRAILER_NAME;
use crate::storage::infrastructure::repository_ref_helpers::utf8_trimmed;
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const RECEIPT_AUTHOR_NAME: &str = "Tessera";
const RECEIPT_AUTHOR_EMAIL: &str = "merge@tessera.invalid";
const RECEIPT_SUBJECT: &str = "Tessera merge receipt";
const STRATEGY_TRAILER: &str = "Tessera-Strategy:";
const BASE_TRAILER: &str = "Tessera-Base:";
const HEAD_TRAILER: &str = "Tessera-Head:";
const RESULT_TRAILER: &str = "Tessera-Result:";

/// What one merge did, written by the service and readable only by it.
///
/// The receipt is created in the same `update-ref` transaction as the target
/// compare-and-swap, so it exists exactly when the target moved. That is what
/// lets a retry tell its own completed work — which it should report as success
/// — from another writer having reached the same commit, which is staleness.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct MergeReceipt {
    pub strategy: RepositoryMergeStrategy,
    pub base_sha: String,
    pub head_sha: String,
    pub resulting_sha: String,
}

/// Where one operation's receipt lives. The namespace is hidden from both Git
/// transports, so a client can neither see it advertised nor write into it.
pub(super) fn operation_ref(operation_id: &str) -> String {
    format!("{TESSERA_REF_NAMESPACE}/operations/{operation_id}")
}

/// The operation identifier becomes a ref name, so it is held to a shape that
/// cannot escape the namespace or collide with Git's own syntax: a UUID and
/// nothing else.
pub(super) fn validate_operation_id(value: &str) -> Result<(), RepositoryError> {
    let bytes = value.as_bytes();

    if bytes.len() != 36 {
        return Err(RepositoryError::InvalidMergeInput);
    }

    let is_valid = bytes.iter().enumerate().all(|(index, byte)| match index {
        8 | 13 | 18 | 23 => *byte == b'-',
        _ => byte.is_ascii_hexdigit(),
    });

    if is_valid {
        Ok(())
    } else {
        Err(RepositoryError::InvalidMergeInput)
    }
}

impl RepositoryStorage {
    /// Writes the receipt commit. Its parents are the merge-time base, head and
    /// result, which is what keeps those objects reachable after the source
    /// branch is deleted — a squashed or rebased pull request has no other
    /// anchor for the pair its merged comparison is read from.
    pub(super) async fn create_merge_receipt(
        &self,
        repository_path: &Path,
        receipt: &MergeReceipt,
        operation_id: &str,
    ) -> Result<String, RepositoryError> {
        let tree_sha = resolve_commit_tree(self, repository_path, &receipt.resulting_sha).await?;
        let mut parents = vec![receipt.base_sha.as_str()];

        for candidate in [&receipt.head_sha, &receipt.resulting_sha] {
            if !parents.contains(&candidate.as_str()) {
                parents.push(candidate);
            }
        }

        create_commit(
            self,
            repository_path,
            ObjectStore::repository(),
            CommitTreeRequest {
                tree_sha: &tree_sha,
                parents: &parents,
                author_name: RECEIPT_AUTHOR_NAME,
                author_email: RECEIPT_AUTHOR_EMAIL,
                author_date: None,
                committer_name: RECEIPT_AUTHOR_NAME,
                committer_email: RECEIPT_AUTHOR_EMAIL,
                message: receipt_message(receipt, operation_id).as_bytes(),
            },
        )
        .await
    }

    /// The receipt filed under this operation, if one is.
    ///
    /// A ref that does not exist is an answer: this operation never moved the
    /// target. Git failing to be asked is not — and the difference matters,
    /// because a caller recovering an abandoned merge releases the intent when
    /// told there is no receipt, which would throw away the record of a merge
    /// that did happen. So existence is established first, and any failure to
    /// read a ref that does exist is reported as the failure it is.
    ///
    /// A receipt that exists but cannot be parsed stays `None`: that is a
    /// malformed receipt rather than a broken Git, and no caller can act on it.
    pub(super) async fn read_merge_receipt(
        &self,
        repository_path: &Path,
        operation_id: &str,
    ) -> Result<Option<MergeReceipt>, RepositoryError> {
        let operation_ref = operation_ref(operation_id);
        let exists = self
            .git(
                repository_path,
                [
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    "--end-of-options",
                    &format!("{operation_ref}^{{commit}}"),
                ],
            )
            .await?;

        // `--quiet` makes a missing ref exit 1 with nothing on stderr, which is
        // the one non-zero exit that means "no receipt" rather than "no answer".
        match exists.status.code() {
            Some(0) => {}
            Some(1) => return Ok(None),
            _ => return Err(RepositoryError::GitProcessFailed),
        }

        let output = self
            .git(
                repository_path,
                ["log", "--max-count=1", "--format=%B", &operation_ref, "--"],
            )
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(parse_receipt(&utf8_trimmed(&output.stdout)?))
    }
}

fn receipt_message(receipt: &MergeReceipt, operation_id: &str) -> String {
    let MergeReceipt {
        strategy,
        base_sha,
        head_sha,
        resulting_sha,
    } = receipt;

    format!(
        "{RECEIPT_SUBJECT}\n\n\
         {OPERATION_TRAILER_NAME}: {operation_id}\n\
         {STRATEGY_TRAILER} {strategy}\n\
         {BASE_TRAILER} {base_sha}\n\
         {HEAD_TRAILER} {head_sha}\n\
         {RESULT_TRAILER} {resulting_sha}\n",
        strategy = strategy.as_receipt_name(),
    )
}

fn parse_receipt(message: &str) -> Option<MergeReceipt> {
    let strategy =
        RepositoryMergeStrategy::from_receipt_name(&trailer(message, STRATEGY_TRAILER)?)?;
    let base_sha = trailer(message, BASE_TRAILER)?;
    let head_sha = trailer(message, HEAD_TRAILER)?;
    let resulting_sha = trailer(message, RESULT_TRAILER)?;

    if [&base_sha, &head_sha, &resulting_sha]
        .iter()
        .any(|value| value.is_empty())
    {
        return None;
    }

    Some(MergeReceipt {
        strategy,
        base_sha,
        head_sha,
        resulting_sha,
    })
}

fn trailer(message: &str, name: &str) -> Option<String> {
    message
        .lines()
        .find_map(|line| line.trim().strip_prefix(name))
        .map(|value| value.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn receipt() -> MergeReceipt {
        MergeReceipt {
            strategy: RepositoryMergeStrategy::Rebase,
            base_sha: "1".repeat(40),
            head_sha: "2".repeat(40),
            resulting_sha: "3".repeat(40),
        }
    }

    #[test]
    fn a_receipt_survives_being_written_and_read_back() {
        let receipt = receipt();

        let parsed = parse_receipt(&receipt_message(
            &receipt,
            "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5",
        ));

        assert_eq!(parsed, Some(receipt));
    }

    #[test]
    fn an_incomplete_receipt_is_no_receipt() {
        assert_eq!(
            parse_receipt("Tessera merge receipt\n\nTessera-Strategy: squash\n"),
            None
        );
    }

    #[test]
    fn an_unknown_strategy_is_no_receipt() {
        let message = receipt_message(&receipt(), "operation").replace("rebase", "cherry_pick");

        assert_eq!(parse_receipt(&message), None);
    }

    #[test]
    fn operation_ids_must_be_uuids() {
        assert!(validate_operation_id("018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5").is_ok());

        for invalid in [
            "../../../heads/main",
            "018f6f4a11d37c8b9c5e5cf1d2e3a4b5",
            "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b",
            "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4bz",
            "",
        ] {
            assert!(
                matches!(
                    validate_operation_id(invalid),
                    Err(RepositoryError::InvalidMergeInput)
                ),
                "{invalid} was accepted"
            );
        }
    }

    #[test]
    fn the_operation_ref_stays_inside_the_hidden_namespace() {
        assert_eq!(
            operation_ref("018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5"),
            "refs/tessera/operations/018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5"
        );
    }
}
