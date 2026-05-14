use std::path::Path;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{
    RepositoryBrowserSummary, RepositoryError, RepositoryReadme, RepositoryTreeEntry,
    RepositoryTreeEntryKind,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const README_MAX_BYTES: usize = 256 * 1024;
const README_FILENAMES: [&str; 6] = [
    "README.md",
    "README.markdown",
    "README.mdown",
    "README.txt",
    "README.rst",
    "README",
];

impl RepositoryStorage {
    pub async fn get_repository_browser_summary(
        &self,
        repository_id: &str,
        storage_path: &str,
        default_branch: &str,
    ) -> Result<RepositoryBrowserSummary, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let default_branch = normalize_requested_ref(default_branch)?;
        let symbolic_head = self.symbolic_head(&repository_path).await?;
        let requested_branch = default_branch.as_deref();
        let resolved_branch = requested_branch.or(symbolic_head.as_deref()).unwrap_or("");

        let Some((branch_name, commit_id)) = self
            .resolve_default_branch(&repository_path, requested_branch, symbolic_head.as_deref())
            .await?
        else {
            return Ok(RepositoryBrowserSummary {
                is_empty: true,
                default_branch: resolved_branch.to_string(),
                root_entries: Vec::new(),
                readme: None,
            });
        };

        let root_entries = self.root_tree_entries(&repository_path, &commit_id).await?;
        let readme = self.readme(&repository_path, &root_entries).await?;

        Ok(RepositoryBrowserSummary {
            is_empty: false,
            default_branch: branch_name,
            root_entries,
            readme,
        })
    }

    async fn symbolic_head(
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

    async fn resolve_default_branch(
        &self,
        repository_path: &Path,
        requested_branch: Option<&str>,
        symbolic_head: Option<&str>,
    ) -> Result<Option<(String, String)>, RepositoryError> {
        if let Some(branch_name) = requested_branch {
            if let Some(commit_id) = self.resolve_branch(repository_path, branch_name).await? {
                return Ok(Some((branch_name.to_string(), commit_id)));
            }
        }

        if let Some(branch_name) = symbolic_head {
            if requested_branch != Some(branch_name) {
                if let Some(commit_id) = self.resolve_branch(repository_path, branch_name).await? {
                    return Ok(Some((branch_name.to_string(), commit_id)));
                }
            }
        }

        Ok(None)
    }

    async fn resolve_branch(
        &self,
        repository_path: &Path,
        branch_name: &str,
    ) -> Result<Option<String>, RepositoryError> {
        validate_git_ref(branch_name)?;
        let ref_name = format!("refs/heads/{branch_name}^{{commit}}");
        let output = self
            .git(
                repository_path,
                ["rev-parse", "--verify", "--end-of-options", &ref_name],
            )
            .await?;

        if !output.status.success() {
            return Ok(None);
        }

        let commit_id =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;

        Ok(Some(commit_id.trim().to_string()))
    }

    async fn root_tree_entries(
        &self,
        repository_path: &Path,
        commit_id: &str,
    ) -> Result<Vec<RepositoryTreeEntry>, RepositoryError> {
        let output = self
            .git(repository_path, ["ls-tree", "-z", "-l", commit_id, "--"])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        parse_ls_tree_entries(&output.stdout)
    }

    async fn readme(
        &self,
        repository_path: &Path,
        root_entries: &[RepositoryTreeEntry],
    ) -> Result<Option<RepositoryReadme>, RepositoryError> {
        let Some(entry) = README_FILENAMES.iter().find_map(|filename| {
            root_entries.iter().find(|entry| {
                entry.kind == RepositoryTreeEntryKind::File
                    && entry.name.eq_ignore_ascii_case(filename)
            })
        }) else {
            return Ok(None);
        };

        let (content, is_truncated) = self
            .read_blob_prefix(repository_path, &entry.object_id)
            .await?;

        Ok(Some(RepositoryReadme {
            filename: entry.name.clone(),
            object_id: entry.object_id.clone(),
            content,
            is_truncated,
        }))
    }

    async fn read_blob_prefix(
        &self,
        repository_path: &Path,
        object_id: &str,
    ) -> Result<(Vec<u8>, bool), RepositoryError> {
        let mut child = Command::new(&self.git_binary)
            .arg("--git-dir")
            .arg(repository_path)
            .args(["cat-file", "blob", object_id])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(RepositoryError::GitProcessIo)?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or(RepositoryError::GitProcessFailed)?;
        let mut content = Vec::with_capacity(README_MAX_BYTES);
        let mut buffer = [0_u8; 8192];
        let mut is_truncated = false;

        let read_result = timeout(Duration::from_secs(15), async {
            loop {
                let read_bytes = stdout
                    .read(&mut buffer)
                    .await
                    .map_err(RepositoryError::GitProcessIo)?;

                if read_bytes == 0 {
                    break Ok(());
                }

                let remaining_bytes = README_MAX_BYTES.saturating_sub(content.len());

                if read_bytes > remaining_bytes {
                    content.extend_from_slice(&buffer[..remaining_bytes]);
                    is_truncated = true;
                    break Ok(());
                }

                content.extend_from_slice(&buffer[..read_bytes]);
            }
        })
        .await;

        // The process may exit naturally before cleanup, or with a non-zero status
        // when we intentionally stop reading after the README byte limit.
        let _ = child.kill().await;
        let status = child.wait().await.map_err(RepositoryError::GitProcessIo)?;

        match read_result {
            Ok(Ok(())) if status.success() || is_truncated => Ok((content, is_truncated)),
            Ok(Ok(())) => Err(RepositoryError::GitProcessFailed),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(RepositoryError::GitProcessFailed),
        }
    }

    async fn git<const N: usize>(
        &self,
        repository_path: &Path,
        args: [&str; N],
    ) -> Result<std::process::Output, RepositoryError> {
        timeout(
            Duration::from_secs(15),
            Command::new(&self.git_binary)
                .arg("--git-dir")
                .arg(repository_path)
                .args(args)
                .output(),
        )
        .await
        .map_err(|_| RepositoryError::GitProcessFailed)?
        .map_err(RepositoryError::GitProcessIo)
    }
}

fn normalize_requested_ref(value: &str) -> Result<Option<String>, RepositoryError> {
    let value = value.trim();

    if value.is_empty() {
        return Ok(None);
    }

    validate_git_ref(value)?;

    Ok(Some(value.to_string()))
}

fn validate_git_ref(value: &str) -> Result<(), RepositoryError> {
    if value.is_empty()
        || value.starts_with('-')
        || value.starts_with('/')
        || value.ends_with('/')
        || value.ends_with('.')
        || value.ends_with(".lock")
        || value.contains('\0')
        || value.contains("..")
        || value.contains("//")
        || value.contains("@{")
        || value.contains('\\')
        || value.chars().any(|character| {
            matches!(
                character,
                ' ' | '\t' | '\r' | '\n' | '~' | '^' | ':' | '?' | '*' | '['
            )
        })
        || value.split('/').any(|part| part == "." || part == "..")
    {
        return Err(RepositoryError::InvalidRepositoryRef);
    }

    Ok(())
}

fn parse_ls_tree_entries(output: &[u8]) -> Result<Vec<RepositoryTreeEntry>, RepositoryError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();

    for raw_entry in output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let tab_index = raw_entry
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let metadata = std::str::from_utf8(&raw_entry[..tab_index])
            .map_err(|_| RepositoryError::InvalidGitOutput)?;
        let name = std::str::from_utf8(&raw_entry[tab_index + 1..])
            .map_err(|_| RepositoryError::InvalidGitOutput)?;

        if name.is_empty() || name.contains('/') {
            return Err(RepositoryError::InvalidRepositoryPath);
        }

        let mut metadata_parts = metadata.split_whitespace();
        let mode = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let object_type = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let object_id = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let size = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;

        let kind = match (mode, object_type) {
            ("040000", "tree") => RepositoryTreeEntryKind::Directory,
            ("120000", "blob") => RepositoryTreeEntryKind::Symlink,
            ("160000", "commit") => RepositoryTreeEntryKind::Submodule,
            (_, "blob") => RepositoryTreeEntryKind::File,
            _ => return Err(RepositoryError::InvalidGitOutput),
        };
        let size_bytes = if size == "-" {
            0
        } else {
            size.parse()
                .map_err(|_| RepositoryError::InvalidGitOutput)?
        };

        entries.push(RepositoryTreeEntry {
            name: name.to_string(),
            object_id: object_id.to_string(),
            kind,
            size_bytes,
            path: name.to_string(),
            mode: mode.to_string(),
        });
    }

    entries.sort_by(|left, right| left.name.cmp(&right.name));

    Ok(entries)
}
