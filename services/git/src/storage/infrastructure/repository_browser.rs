use std::path::Path;

use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{
    RepositoryBlobPreview, RepositoryBrowserSummary, RepositoryError, RepositoryRawBlob,
    RepositoryReadme, RepositoryRef, RepositoryRefKind, RepositoryRefList, RepositoryTree,
    RepositoryTreeEntry, RepositoryTreeEntryKind,
};
use crate::storage::infrastructure::repository_browser_helpers::{
    normalize_repository_path, normalize_requested_ref, parse_ls_tree_entries, treeish_path,
    validate_git_ref, validate_object_id,
};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

const BLOB_PREVIEW_MAX_BYTES: usize = 512 * 1024;
const RAW_BLOB_MAX_BYTES: u64 = 10 * 1024 * 1024;
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
        ref_name: &str,
    ) -> Result<RepositoryBrowserSummary, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let default_branch = normalize_requested_ref(default_branch)?;
        let selected_ref = normalize_requested_ref(ref_name)?;
        let symbolic_head = self.symbolic_head(&repository_path).await?;
        let requested_branch = default_branch.as_deref();
        let resolved_branch = requested_branch.or(symbolic_head.as_deref()).unwrap_or("");

        let resolved_ref = if let Some(ref_name) = selected_ref.as_deref() {
            Some((
                resolved_branch.to_string(),
                self.resolve_browser_ref(&repository_path, ref_name).await?,
            ))
        } else {
            self.resolve_default_branch(
                &repository_path,
                requested_branch,
                symbolic_head.as_deref(),
            )
            .await?
        };

        let Some((branch_name, commit_id)) = resolved_ref else {
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

    pub async fn list_repository_refs(
        &self,
        repository_id: &str,
        storage_path: &str,
    ) -> Result<RepositoryRefList, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        let default_branch = self.symbolic_head(&repository_path).await?;
        let output = self
            .git(
                &repository_path,
                [
                    "for-each-ref",
                    "--format=%(refname)%00%(refname:short)%00%(objectname)%1e",
                    "refs/heads",
                    "refs/tags",
                ],
            )
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        let refs = self
            .parse_repository_refs(&repository_path, &output.stdout, default_branch.as_deref())
            .await?;

        Ok(RepositoryRefList { refs })
    }

    pub async fn get_repository_tree(
        &self,
        repository_id: &str,
        storage_path: &str,
        ref_name: &str,
        path: &str,
    ) -> Result<RepositoryTree, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        validate_git_ref(ref_name)?;
        let path = normalize_repository_path(path)?;
        let commit_id = self.resolve_commit_ref(&repository_path, ref_name).await?;
        let treeish = treeish_path(&commit_id, &path);
        let object_type = self.object_type(&repository_path, &treeish).await?;

        if object_type != "tree" {
            return Err(RepositoryError::WrongObjectKind);
        }

        let entries = self
            .tree_entries(&repository_path, &treeish, path.as_deref().unwrap_or(""))
            .await?;

        Ok(RepositoryTree {
            commit_id,
            path: path.unwrap_or_default(),
            entries,
        })
    }

    pub async fn get_repository_blob(
        &self,
        repository_id: &str,
        storage_path: &str,
        object_id: &str,
    ) -> Result<RepositoryBlobPreview, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        validate_object_id(object_id)?;
        let object_type = self.object_type(&repository_path, object_id).await?;

        if object_type != "blob" {
            return Err(RepositoryError::WrongObjectKind);
        }

        let size_bytes = self.object_size(&repository_path, object_id).await?;

        if size_bytes > BLOB_PREVIEW_MAX_BYTES as u64 {
            return Ok(RepositoryBlobPreview::TooLarge {
                object_id: object_id.to_string(),
                size_bytes,
                preview_limit_bytes: BLOB_PREVIEW_MAX_BYTES as u64,
            });
        }

        let content = self.read_exact_blob(&repository_path, object_id).await?;

        if content.contains(&0) {
            return Ok(RepositoryBlobPreview::Binary {
                object_id: object_id.to_string(),
                size_bytes,
                preview_limit_bytes: BLOB_PREVIEW_MAX_BYTES as u64,
            });
        }

        let Ok(text) = String::from_utf8(content) else {
            return Ok(RepositoryBlobPreview::Binary {
                object_id: object_id.to_string(),
                size_bytes,
                preview_limit_bytes: BLOB_PREVIEW_MAX_BYTES as u64,
            });
        };

        Ok(RepositoryBlobPreview::Text {
            object_id: object_id.to_string(),
            text,
            size_bytes,
            preview_limit_bytes: BLOB_PREVIEW_MAX_BYTES as u64,
        })
    }

    pub async fn get_repository_raw_blob(
        &self,
        repository_id: &str,
        storage_path: &str,
        object_id: &str,
    ) -> Result<RepositoryRawBlob, RepositoryError> {
        let repository_path = self
            .existing_bare_repository_path(repository_id, storage_path)
            .await?;
        validate_object_id(object_id)?;
        let object_type = self.object_type(&repository_path, object_id).await?;

        if object_type != "blob" {
            return Err(RepositoryError::WrongObjectKind);
        }

        let size_bytes = self.object_size(&repository_path, object_id).await?;
        if size_bytes > RAW_BLOB_MAX_BYTES {
            return Err(RepositoryError::BlobTooLarge);
        }

        let content = self.read_exact_blob(&repository_path, object_id).await?;

        Ok(RepositoryRawBlob {
            object_id: object_id.to_string(),
            content,
            size_bytes,
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

    async fn resolve_browser_ref(
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

    async fn parse_repository_refs(
        &self,
        repository_path: &Path,
        output: &[u8],
        default_branch: Option<&str>,
    ) -> Result<Vec<RepositoryRef>, RepositoryError> {
        let mut refs = Vec::new();

        for record in output
            .split(|byte| *byte == 0x1e)
            .filter(|record| !record.is_empty() && *record != b"\n")
        {
            let record = record.strip_prefix(b"\n").unwrap_or(record);
            let fields: Vec<&[u8]> = record.split(|byte| *byte == 0).collect();
            if fields.len() != 3 {
                return Err(RepositoryError::InvalidGitOutput);
            }

            let qualified_name = utf8_ref_field(fields[0])?;
            let display_name = utf8_ref_field(fields[1])?;
            let object_id = utf8_ref_field(fields[2])?;

            if qualified_name.starts_with("refs/heads/") {
                let is_default_branch = default_branch == Some(display_name.as_str());
                refs.push(RepositoryRef {
                    kind: RepositoryRefKind::Branch,
                    display_name,
                    qualified_name,
                    commit_id: object_id,
                    is_default_branch,
                });
                continue;
            }

            if !qualified_name.starts_with("refs/tags/") {
                return Err(RepositoryError::InvalidGitOutput);
            }

            let Ok(commit_id) = self
                .resolve_browser_ref(repository_path, &qualified_name)
                .await
            else {
                continue;
            };

            refs.push(RepositoryRef {
                kind: RepositoryRefKind::Tag,
                display_name,
                qualified_name,
                commit_id,
                is_default_branch: false,
            });
        }

        refs.sort_by(|left, right| {
            ref_kind_order(&left.kind)
                .cmp(&ref_kind_order(&right.kind))
                .then_with(|| left.display_name.cmp(&right.display_name))
        });

        Ok(refs)
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

        parse_ls_tree_entries(&output.stdout, "")
    }

    async fn tree_entries(
        &self,
        repository_path: &Path,
        treeish: &str,
        parent_path: &str,
    ) -> Result<Vec<RepositoryTreeEntry>, RepositoryError> {
        let output = self
            .git(repository_path, ["ls-tree", "-z", "-l", treeish])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        parse_ls_tree_entries(&output.stdout, parent_path)
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

    async fn read_exact_blob(
        &self,
        repository_path: &Path,
        object_id: &str,
    ) -> Result<Vec<u8>, RepositoryError> {
        let output = self
            .git(repository_path, ["cat-file", "blob", object_id])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::GitProcessFailed);
        }

        Ok(output.stdout)
    }

    async fn object_type(
        &self,
        repository_path: &Path,
        object_id: &str,
    ) -> Result<String, RepositoryError> {
        let output = self
            .git(repository_path, ["cat-file", "-t", object_id])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::RepositoryObjectNotFound);
        }

        let value =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;

        Ok(value.trim().to_string())
    }

    async fn object_size(
        &self,
        repository_path: &Path,
        object_id: &str,
    ) -> Result<u64, RepositoryError> {
        let output = self
            .git(repository_path, ["cat-file", "-s", object_id])
            .await?;

        if !output.status.success() {
            return Err(RepositoryError::RepositoryObjectNotFound);
        }

        let value =
            String::from_utf8(output.stdout).map_err(|_| RepositoryError::InvalidGitOutput)?;

        value
            .trim()
            .parse()
            .map_err(|_| RepositoryError::InvalidGitOutput)
    }

    async fn resolve_commit_ref(
        &self,
        repository_path: &Path,
        ref_name: &str,
    ) -> Result<String, RepositoryError> {
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

    pub(super) async fn git<const N: usize>(
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

fn utf8_ref_field(field: &[u8]) -> Result<String, RepositoryError> {
    String::from_utf8(field.to_vec()).map_err(|_| RepositoryError::InvalidGitOutput)
}

fn ref_kind_order(kind: &RepositoryRefKind) -> u8 {
    match kind {
        RepositoryRefKind::Branch => 0,
        RepositoryRefKind::Tag => 1,
    }
}
