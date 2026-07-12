use std::collections::HashMap;
use std::path::Path;
use std::process::{ExitStatus, Stdio};

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{
    RepositoryChangedFile, RepositoryChangedFileStatus, RepositoryCommitIdentity,
    RepositoryComparison, RepositoryComparisonCommit, RepositoryDiffHunk, RepositoryDiffLine,
    RepositoryDiffLineKind, RepositoryError, RepositoryFileDiff,
};
use crate::storage::infrastructure::repository_browser_helpers::{
    normalize_repository_path, validate_object_id,
};
use crate::storage::infrastructure::repository_ref_helpers::{
    qualified_branch_ref, resolve_commit_ref, utf8_trimmed,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const COMPARISON_FILE_LIMIT: usize = 300;
const COMPARISON_COMMIT_LIMIT: usize = 500;
const COMPARISON_COMMIT_OUTPUT_LIMIT_BYTES: usize = 4 * 1024 * 1024;
const COMPARISON_METADATA_OUTPUT_LIMIT_BYTES: usize = 8 * 1024 * 1024;
const PATCH_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const COMPARISON_COMMAND_TIMEOUT: Duration = Duration::from_secs(30);
const COMPARISON_OPERATION_TIMEOUT: Duration = Duration::from_secs(45);

struct LimitedGitOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    is_truncated: bool,
}

impl RepositoryStorage {
    pub async fn compare_repository_refs(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
    ) -> Result<RepositoryComparison, RepositoryError> {
        timeout(
            COMPARISON_OPERATION_TIMEOUT,
            self.compare_repository_refs_inner(repository_id, storage_path, base_ref, head_ref),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
    }

    async fn compare_repository_refs_inner(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
    ) -> Result<RepositoryComparison, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let (base_sha, head_sha, merge_base_sha) = self
            .resolve_comparison_refs(&repository_path, base_ref, head_ref)
            .await?;
        let (commits, commits_truncated) = self
            .comparison_commits(&repository_path, &merge_base_sha, &head_sha)
            .await?;
        let (mut files, files_output_truncated) = self
            .comparison_files(&repository_path, &merge_base_sha, &head_sha)
            .await?;
        let is_truncated = files_output_truncated || files.len() > COMPARISON_FILE_LIMIT;
        files.truncate(COMPARISON_FILE_LIMIT);

        Ok(RepositoryComparison {
            base_sha,
            head_sha,
            merge_base_sha,
            commits,
            files,
            is_truncated,
            file_limit: COMPARISON_FILE_LIMIT as u32,
            commits_truncated,
            commit_limit: COMPARISON_COMMIT_LIMIT as u32,
        })
    }

    pub async fn get_repository_file_diff(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
        path: &str,
    ) -> Result<RepositoryFileDiff, RepositoryError> {
        timeout(
            COMPARISON_OPERATION_TIMEOUT,
            self.get_repository_file_diff_inner(
                repository_id,
                storage_path,
                base_ref,
                head_ref,
                path,
            ),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
    }

    async fn get_repository_file_diff_inner(
        &self,
        repository_id: &str,
        storage_path: &str,
        base_ref: &str,
        head_ref: &str,
        path: &str,
    ) -> Result<RepositoryFileDiff, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let requested_path =
            normalize_repository_path(path)?.ok_or(RepositoryError::ComparisonFileNotFound)?;
        let (base_sha, head_sha, merge_base_sha) = self
            .resolve_comparison_refs(&repository_path, base_ref, head_ref)
            .await?;
        let (files, _) = self
            .comparison_files(&repository_path, &merge_base_sha, &head_sha)
            .await?;
        let file = files
            .into_iter()
            .find(|file| file.old_path == requested_path || file.new_path == requested_path)
            .ok_or(RepositoryError::ComparisonFileNotFound)?;
        let output = if file.new_path == file.old_path {
            self.git_limited(
                &repository_path,
                [
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--unified=3",
                    "--find-renames",
                    &merge_base_sha,
                    &head_sha,
                    "--",
                    &file.old_path,
                ],
                PATCH_LIMIT_BYTES,
            )
            .await?
        } else {
            self.git_limited(
                &repository_path,
                [
                    "diff",
                    "--no-color",
                    "--no-ext-diff",
                    "--unified=3",
                    "--find-renames",
                    &merge_base_sha,
                    &head_sha,
                    "--",
                    &file.old_path,
                    &file.new_path,
                ],
                PATCH_LIMIT_BYTES,
            )
            .await?
        };

        if !output.status.success() && !output.is_truncated {
            return Err(RepositoryError::GitProcessFailed);
        }

        let patch = if output.is_truncated {
            let end = output
                .stdout
                .iter()
                .rposition(|byte| *byte == b'\n')
                .map_or(0, |index| index + 1);
            &output.stdout[..end]
        } else {
            &output.stdout
        };

        Ok(RepositoryFileDiff {
            base_sha,
            head_sha,
            merge_base_sha,
            file,
            hunks: parse_diff_hunks(patch)?,
            is_truncated: output.is_truncated,
            patch_limit_bytes: PATCH_LIMIT_BYTES as u64,
        })
    }

    async fn resolve_comparison_refs(
        &self,
        repository_path: &Path,
        base_ref: &str,
        head_ref: &str,
    ) -> Result<(String, String, String), RepositoryError> {
        let base_ref = validated_comparison_ref(base_ref)?;
        let head_ref = validated_comparison_ref(head_ref)?;
        let base_sha = resolve_commit_ref(self, repository_path, &base_ref).await?;
        let head_sha = resolve_commit_ref(self, repository_path, &head_ref).await?;
        let output = self
            .git(repository_path, ["merge-base", &base_sha, &head_sha])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::InvalidRepositoryRef);
        }

        let merge_base_sha = utf8_trimmed(&output.stdout)?;
        if merge_base_sha.is_empty() {
            return Err(RepositoryError::InvalidGitOutput);
        }

        Ok((base_sha, head_sha, merge_base_sha))
    }

    async fn comparison_commits(
        &self,
        repository_path: &Path,
        merge_base_sha: &str,
        head_sha: &str,
    ) -> Result<(Vec<RepositoryComparisonCommit>, bool), RepositoryError> {
        let range = format!("{merge_base_sha}..{head_sha}");
        let max_count = format!("--max-count={}", COMPARISON_COMMIT_LIMIT + 1);
        let output = self
            .git_limited(
                repository_path,
                [
                    "log",
                    "--reverse",
                    "--topo-order",
                    &max_count,
                    "--date=iso-strict",
                    "--format=format:%H%x00%h%x00%s%x00%an%x00%ae%x00%aI%x1e",
                    &range,
                    "--",
                ],
                COMPARISON_COMMIT_OUTPUT_LIMIT_BYTES,
            )
            .await?;

        if !output.status.success() && !output.is_truncated {
            return Err(RepositoryError::GitProcessFailed);
        }

        let complete_output = if output.is_truncated {
            let end = output
                .stdout
                .iter()
                .rposition(|byte| *byte == 0x1e)
                .map_or(0, |index| index + 1);
            &output.stdout[..end]
        } else {
            &output.stdout
        };
        let mut commits = parse_comparison_commits(complete_output)?;
        let commits_truncated = output.is_truncated || commits.len() > COMPARISON_COMMIT_LIMIT;
        commits.truncate(COMPARISON_COMMIT_LIMIT);

        Ok((commits, commits_truncated))
    }

    async fn git_limited<const N: usize>(
        &self,
        repository_path: &Path,
        args: [&str; N],
        limit: usize,
    ) -> Result<LimitedGitOutput, RepositoryError> {
        let mut child = Command::new(&self.git_binary)
            .arg("--git-dir")
            .arg(repository_path)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(RepositoryError::GitProcessIo)?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or(RepositoryError::GitProcessFailed)?;
        let read_result = timeout(COMPARISON_COMMAND_TIMEOUT, async {
            let mut content = Vec::with_capacity(limit);
            let mut buffer = [0_u8; 8192];

            loop {
                let read_bytes = stdout
                    .read(&mut buffer)
                    .await
                    .map_err(RepositoryError::GitProcessIo)?;
                if read_bytes == 0 {
                    return Ok((content, false));
                }

                let remaining = limit.saturating_sub(content.len());
                if read_bytes > remaining {
                    content.extend_from_slice(&buffer[..remaining]);
                    return Ok((content, true));
                }

                content.extend_from_slice(&buffer[..read_bytes]);
            }
        })
        .await;
        let (content, is_truncated) = match read_result {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(error);
            }
            Err(_) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                return Err(RepositoryError::GitProcessFailed);
            }
        };
        if is_truncated {
            let _ = child.kill().await;
        }
        let status = child.wait().await.map_err(RepositoryError::GitProcessIo)?;

        Ok(LimitedGitOutput {
            status,
            stdout: content,
            is_truncated,
        })
    }

    async fn comparison_files(
        &self,
        repository_path: &Path,
        merge_base_sha: &str,
        head_sha: &str,
    ) -> Result<(Vec<RepositoryChangedFile>, bool), RepositoryError> {
        let raw_output = self
            .git_limited(
                repository_path,
                [
                    "diff",
                    "--raw",
                    "-z",
                    "--find-renames",
                    "--abbrev=64",
                    merge_base_sha,
                    head_sha,
                    "--",
                ],
                COMPARISON_METADATA_OUTPUT_LIMIT_BYTES,
            )
            .await?;
        let numstat_output = self
            .git_limited(
                repository_path,
                [
                    "diff",
                    "--numstat",
                    "-z",
                    "--find-renames",
                    merge_base_sha,
                    head_sha,
                    "--",
                ],
                COMPARISON_METADATA_OUTPUT_LIMIT_BYTES,
            )
            .await?;

        if (!raw_output.status.success() && !raw_output.is_truncated)
            || (!numstat_output.status.success() && !numstat_output.is_truncated)
        {
            return Err(RepositoryError::GitProcessFailed);
        }

        let numstat = complete_nul_output(&numstat_output.stdout, numstat_output.is_truncated);
        let raw = complete_nul_output(&raw_output.stdout, raw_output.is_truncated);
        let stats = parse_numstat(numstat, numstat_output.is_truncated)?;
        let files = parse_raw_files(raw, &stats, raw_output.is_truncated)?;

        Ok((
            files,
            raw_output.is_truncated || numstat_output.is_truncated,
        ))
    }
}

fn complete_nul_output(output: &[u8], is_truncated: bool) -> &[u8] {
    if !is_truncated {
        return output;
    }

    let end = output
        .iter()
        .rposition(|byte| *byte == 0)
        .map_or(0, |index| index + 1);
    &output[..end]
}

fn validated_comparison_ref(value: &str) -> Result<String, RepositoryError> {
    if validate_object_id(value).is_ok() {
        return Ok(value.to_string());
    }

    if let Some((object_id, parent)) = value.rsplit_once('^') {
        if matches!(parent, "1" | "2") && validate_object_id(object_id).is_ok() {
            return Ok(value.to_string());
        }
    }

    qualified_branch_ref(value)
}

fn parse_comparison_commits(
    output: &[u8],
) -> Result<Vec<RepositoryComparisonCommit>, RepositoryError> {
    output
        .split(|byte| *byte == 0x1e)
        .filter(|record| !record.is_empty() && *record != b"\n")
        .map(|record| {
            let record = record.strip_prefix(b"\n").unwrap_or(record);
            let fields: Vec<&[u8]> = record.split(|byte| *byte == 0).collect();
            if fields.len() != 6 {
                return Err(RepositoryError::InvalidGitOutput);
            }

            Ok(RepositoryComparisonCommit {
                sha: utf8(fields[0])?,
                short_sha: utf8(fields[1])?,
                summary: utf8(fields[2])?,
                author: RepositoryCommitIdentity {
                    name: utf8(fields[3])?,
                    email: utf8(fields[4])?,
                    date: utf8(fields[5])?,
                },
            })
        })
        .collect()
}

fn parse_raw_files(
    output: &[u8],
    stats: &HashMap<String, (u32, u32, bool)>,
    allow_incomplete_record: bool,
) -> Result<Vec<RepositoryChangedFile>, RepositoryError> {
    let fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    let mut files = Vec::new();
    let mut index = 0;

    while index < fields.len() && !fields[index].is_empty() {
        let metadata = utf8(fields[index])?;
        index += 1;
        let mut parts = metadata.split_whitespace();
        let old_mode = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let new_mode = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let old_sha = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let new_sha = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let status_field = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let status = status_field
            .chars()
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let Some(old_path_field) = fields.get(index) else {
            if allow_incomplete_record {
                break;
            }
            return Err(RepositoryError::InvalidGitOutput);
        };
        if old_path_field.is_empty() && allow_incomplete_record {
            break;
        }
        let old_path = utf8(old_path_field)?;
        index += 1;
        let new_path = if status == 'R' {
            let Some(new_path_field) = fields.get(index) else {
                if allow_incomplete_record {
                    break;
                }
                return Err(RepositoryError::InvalidGitOutput);
            };
            if new_path_field.is_empty() && allow_incomplete_record {
                break;
            }
            let path = utf8(new_path_field)?;
            index += 1;
            path
        } else {
            old_path.clone()
        };
        let file_status = match status {
            'A' => RepositoryChangedFileStatus::Added,
            'M' | 'T' => RepositoryChangedFileStatus::Modified,
            'D' => RepositoryChangedFileStatus::Deleted,
            'R' => RepositoryChangedFileStatus::Renamed,
            _ => return Err(RepositoryError::InvalidGitOutput),
        };
        let (additions, deletions, is_binary) = stats
            .get(&new_path)
            .or_else(|| stats.get(&old_path))
            .copied()
            .unwrap_or_default();
        let is_gitlink = old_mode == "160000" || new_mode == "160000";

        files.push(RepositoryChangedFile {
            status: file_status,
            old_path,
            new_path,
            base_blob_id: if is_gitlink {
                String::new()
            } else {
                nonzero_object_id(old_sha)
            },
            head_blob_id: if is_gitlink {
                String::new()
            } else {
                nonzero_object_id(new_sha)
            },
            additions,
            deletions,
            is_binary: is_binary || is_gitlink,
        });
    }

    Ok(files)
}

fn parse_numstat(
    output: &[u8],
    allow_incomplete_record: bool,
) -> Result<HashMap<String, (u32, u32, bool)>, RepositoryError> {
    let fields: Vec<&[u8]> = output.split(|byte| *byte == 0).collect();
    let mut stats = HashMap::new();
    let mut index = 0;

    while index < fields.len() && !fields[index].is_empty() {
        let record = utf8(fields[index])?;
        index += 1;
        let mut parts = record.splitn(3, '\t');
        let additions = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let deletions = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let path = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
        let selected_path = if path.is_empty() {
            index += 1;
            let Some(new_path_field) = fields.get(index) else {
                if allow_incomplete_record {
                    break;
                }
                return Err(RepositoryError::InvalidGitOutput);
            };
            if new_path_field.is_empty() && allow_incomplete_record {
                break;
            }
            let new_path = utf8(new_path_field)?;
            index += 1;
            new_path
        } else {
            path.to_string()
        };
        let is_binary = additions == "-" || deletions == "-";
        stats.insert(
            selected_path,
            (
                additions.parse().unwrap_or_default(),
                deletions.parse().unwrap_or_default(),
                is_binary,
            ),
        );
    }

    Ok(stats)
}

fn parse_diff_hunks(output: &[u8]) -> Result<Vec<RepositoryDiffHunk>, RepositoryError> {
    let text = String::from_utf8_lossy(output);
    let mut hunks = Vec::new();
    let mut current_hunk: Option<RepositoryDiffHunk> = None;
    let mut old_line = 0;
    let mut new_line = 0;

    for line in text.lines() {
        if line.starts_with("@@ ") {
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }
            let (parsed_old_line, parsed_new_line) = parse_hunk_start(line)?;
            old_line = parsed_old_line;
            new_line = parsed_new_line;
            current_hunk = Some(RepositoryDiffHunk {
                header: line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }

        let Some(hunk) = current_hunk.as_mut() else {
            continue;
        };
        if line.starts_with("\\ No newline") {
            continue;
        }

        let (kind, line_old, line_new) = if line.starts_with('+') {
            let line_number = new_line;
            new_line += 1;
            (RepositoryDiffLineKind::Addition, None, Some(line_number))
        } else if line.starts_with('-') {
            let line_number = old_line;
            old_line += 1;
            (RepositoryDiffLineKind::Deletion, Some(line_number), None)
        } else if line.starts_with(' ') {
            let current_old_line = old_line;
            let current_new_line = new_line;
            old_line += 1;
            new_line += 1;
            (
                RepositoryDiffLineKind::Context,
                Some(current_old_line),
                Some(current_new_line),
            )
        } else {
            continue;
        };

        hunk.lines.push(RepositoryDiffLine {
            kind,
            content: line[1..].to_string(),
            old_line: line_old,
            new_line: line_new,
        });
    }

    if let Some(hunk) = current_hunk {
        hunks.push(hunk);
    }

    Ok(hunks)
}

fn parse_hunk_start(header: &str) -> Result<(u32, u32), RepositoryError> {
    let mut parts = header.split_whitespace();
    if parts.next() != Some("@@") {
        return Err(RepositoryError::InvalidGitOutput);
    }
    let old = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;
    let new = parts.next().ok_or(RepositoryError::InvalidGitOutput)?;

    Ok((parse_range_start(old, '-')?, parse_range_start(new, '+')?))
}

fn parse_range_start(value: &str, prefix: char) -> Result<u32, RepositoryError> {
    value
        .strip_prefix(prefix)
        .and_then(|value| value.split(',').next())
        .ok_or(RepositoryError::InvalidGitOutput)?
        .parse()
        .map_err(|_| RepositoryError::InvalidGitOutput)
}

fn nonzero_object_id(value: &str) -> String {
    if value.bytes().all(|byte| byte == b'0') {
        String::new()
    } else {
        value.to_string()
    }
}

fn utf8(value: &[u8]) -> Result<String, RepositoryError> {
    String::from_utf8(value.to_vec()).map_err(|_| RepositoryError::InvalidGitOutput)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_diff_line_coordinates() {
        let hunks =
            parse_diff_hunks(b"diff --git a/a b/a\n@@ -2,2 +2,3 @@\n same\n-old\n+new\n+next\n")
                .unwrap();

        assert_eq!(hunks.len(), 1);
        assert_eq!(hunks[0].lines[0].old_line, Some(2));
        assert_eq!(hunks[0].lines[0].new_line, Some(2));
        assert_eq!(hunks[0].lines[1].old_line, Some(3));
        assert_eq!(hunks[0].lines[1].new_line, None);
        assert_eq!(hunks[0].lines[2].old_line, None);
        assert_eq!(hunks[0].lines[2].new_line, Some(3));
    }

    #[test]
    fn rejects_unsafe_branch_refs() {
        assert!(matches!(
            qualified_branch_ref("../main"),
            Err(RepositoryError::InvalidRepositoryRef)
        ));
    }

    #[test]
    fn accepts_exact_object_ids_and_merge_parent_refs() {
        let object_id = "a".repeat(40);

        assert_eq!(validated_comparison_ref(&object_id).unwrap(), object_id);
        assert_eq!(
            validated_comparison_ref(&format!("{object_id}^2")).unwrap(),
            format!("{object_id}^2")
        );
    }

    #[test]
    fn maps_gitlinks_without_exposing_commit_ids_as_blobs() {
        let raw = b":160000 160000 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb M\tsubmodule\0";
        let files = parse_raw_files(raw, &HashMap::new(), false).unwrap();

        assert_eq!(files.len(), 1);
        assert!(files[0].is_binary);
        assert!(files[0].base_blob_id.is_empty());
        assert!(files[0].head_blob_id.is_empty());
    }
}
