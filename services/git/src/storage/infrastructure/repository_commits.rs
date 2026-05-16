use std::path::Path;

use crate::domain::{
    RepositoryCommit, RepositoryCommitIdentity, RepositoryCommitList, RepositoryError,
};
use crate::storage::infrastructure::repository_browser_helpers::{
    normalize_requested_ref, validate_git_ref,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const DEFAULT_COMMIT_LIMIT: u32 = 50;
const MAX_COMMIT_LIMIT: u32 = 100;
const COMMIT_FIELD_COUNT: usize = 9;

impl RepositoryStorage {
    pub async fn list_repository_commits(
        &self,
        repository_id: &str,
        storage_path: &str,
        ref_name: &str,
        limit: u32,
    ) -> Result<RepositoryCommitList, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let resolved_ref = self
            .resolve_commit_list_ref(&repository_path, ref_name)
            .await?;
        if !self.repository_has_commits(&repository_path).await? {
            return Ok(RepositoryCommitList {
                commits: Vec::new(),
            });
        }

        let Some(ref_name) = resolved_ref else {
            return Ok(RepositoryCommitList {
                commits: Vec::new(),
            });
        };
        let commit_id = self
            .resolve_commit_list_commit_ref(&repository_path, &ref_name)
            .await?;
        let limit = normalized_commit_limit(limit).to_string();
        let output = self
            .git(
                &repository_path,
                [
                    "log",
                    "--date=iso-strict",
                    "--format=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x1e",
                    "--max-count",
                    &limit,
                    &commit_id,
                    "--",
                ],
            )
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(RepositoryCommitList {
            commits: parse_commit_log(&output.stdout)?,
        })
    }

    async fn resolve_commit_list_ref(
        &self,
        repository_path: &Path,
        ref_name: &str,
    ) -> Result<Option<String>, RepositoryError> {
        let ref_name = normalize_requested_ref(ref_name)?;

        if let Some(ref_name) = ref_name {
            return Ok(Some(ref_name));
        }

        Ok(self.commit_list_symbolic_head(repository_path).await?)
    }

    async fn commit_list_symbolic_head(
        &self,
        repository_path: &Path,
    ) -> Result<Option<String>, RepositoryError> {
        let output = self
            .git(
                repository_path,
                ["symbolic-ref", "--quiet", "--short", "HEAD"],
            )
            .await?;

        if !output.status.success() {
            return Ok(None);
        }

        let value =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;
        Ok(Some(value.trim().to_string()))
    }

    async fn resolve_commit_list_commit_ref(
        &self,
        repository_path: &Path,
        ref_name: &str,
    ) -> Result<String, RepositoryError> {
        validate_git_ref(ref_name)?;
        let ref_name = format!("{ref_name}^{{commit}}");
        let output = self
            .git(
                repository_path,
                ["rev-parse", "--verify", "--end-of-options", &ref_name],
            )
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::RepositoryObjectNotFound);
        }

        let commit_id =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;

        Ok(commit_id.trim().to_string())
    }

    async fn repository_has_commits(
        &self,
        repository_path: &Path,
    ) -> Result<bool, RepositoryError> {
        let output = self
            .git(repository_path, ["rev-list", "--all", "--max-count=1"])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(!output.stdout.is_empty())
    }
}

fn normalized_commit_limit(limit: u32) -> u32 {
    if limit == 0 {
        return DEFAULT_COMMIT_LIMIT;
    }

    limit.min(MAX_COMMIT_LIMIT)
}

fn parse_commit_log(output: &[u8]) -> Result<Vec<RepositoryCommit>, RepositoryError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }

    output
        .split(|byte| *byte == 0x1e)
        .filter(|record| !record.is_empty() && *record != b"\n")
        .map(parse_commit_record)
        .collect()
}

fn parse_commit_record(record: &[u8]) -> Result<RepositoryCommit, RepositoryError> {
    let record = record.strip_prefix(b"\n").unwrap_or(record);
    let fields: Vec<&[u8]> = record.split(|byte| *byte == 0).collect();

    if fields.len() != COMMIT_FIELD_COUNT {
        return Err(RepositoryError::InvalidGitOutput);
    }

    Ok(RepositoryCommit {
        sha: utf8_field(fields[0])?,
        short_sha: utf8_field(fields[1])?,
        summary: utf8_field(fields[2])?,
        author: RepositoryCommitIdentity {
            name: utf8_field(fields[3])?,
            email: utf8_field(fields[4])?,
            date: utf8_field(fields[5])?,
        },
        committer: RepositoryCommitIdentity {
            name: utf8_field(fields[6])?,
            email: utf8_field(fields[7])?,
            date: utf8_field(fields[8])?,
        },
    })
}

fn utf8_field(field: &[u8]) -> Result<String, RepositoryError> {
    String::from_utf8(field.to_vec()).map_err(|_| RepositoryError::InvalidGitOutput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_commit_limit_defaults_and_caps() {
        assert_eq!(normalized_commit_limit(0), 50);
        assert_eq!(normalized_commit_limit(75), 75);
        assert_eq!(normalized_commit_limit(101), 100);
    }

    #[test]
    fn parse_commit_log_preserves_metadata() {
        let output = b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\0aaaaaaa\0Add thing\0Ada\0ada@example.com\02026-05-16T10:00:00+00:00\0Grace\0grace@example.com\02026-05-16T10:01:00+00:00\x1e";

        let commits = parse_commit_log(output).unwrap();

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].sha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        assert_eq!(commits[0].short_sha, "aaaaaaa");
        assert_eq!(commits[0].summary, "Add thing");
        assert_eq!(commits[0].author.name, "Ada");
        assert_eq!(commits[0].author.email, "ada@example.com");
        assert_eq!(commits[0].author.date, "2026-05-16T10:00:00+00:00");
        assert_eq!(commits[0].committer.name, "Grace");
        assert_eq!(commits[0].committer.email, "grace@example.com");
        assert_eq!(commits[0].committer.date, "2026-05-16T10:01:00+00:00");
    }
}
