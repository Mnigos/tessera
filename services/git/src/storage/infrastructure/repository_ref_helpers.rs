use std::path::Path;

use crate::domain::RepositoryError;
use crate::storage::infrastructure::repository_browser_helpers::validate_git_ref;
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

pub(super) fn qualified_branch_ref(value: &str) -> Result<String, RepositoryError> {
    validate_git_ref(value)?;
    Ok(format!("refs/heads/{value}"))
}

pub(super) async fn resolve_commit_ref(
    storage: &RepositoryStorage,
    repository_path: &Path,
    qualified_ref: &str,
) -> Result<String, RepositoryError> {
    let commit_ref = format!("{qualified_ref}^{{commit}}");
    let output = storage
        .git(
            repository_path,
            ["rev-parse", "--verify", "--end-of-options", &commit_ref],
        )
        .await?;

    if !output.status.success() {
        return Err(RepositoryError::InvalidRepositoryRef);
    }

    utf8_trimmed(&output.stdout)
}

pub(super) fn utf8_trimmed(value: &[u8]) -> Result<String, RepositoryError> {
    Ok(String::from_utf8(value.to_vec())
        .map_err(|_| RepositoryError::InvalidGitOutput)?
        .trim()
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qualified_branch_ref_rejects_unsafe_refs() {
        assert!(matches!(
            qualified_branch_ref("../main"),
            Err(RepositoryError::InvalidRepositoryRef)
        ));
    }

    #[test]
    fn utf8_trimmed_decodes_and_trims_output() {
        assert_eq!(utf8_trimmed(b"abc123\n").unwrap(), "abc123");
    }
}
