use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCreated {
    pub path: PathBuf,
    pub storage_path: String,
    pub created: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryImported {
    pub default_branch: String,
    pub storage_path: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryBrowserSummary {
    pub is_empty: bool,
    pub default_branch: String,
    pub root_entries: Vec<RepositoryTreeEntry>,
    pub readme: Option<RepositoryReadme>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryRefList {
    pub refs: Vec<RepositoryRef>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryRef {
    pub kind: RepositoryRefKind,
    pub display_name: String,
    pub qualified_name: String,
    pub commit_id: String,
    pub is_default_branch: bool,
    pub signature: RepositorySignature,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepositoryRefKind {
    Branch,
    Tag,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryTree {
    pub commit_id: String,
    pub path: String,
    pub entries: Vec<RepositoryTreeEntry>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCommitList {
    pub commits: Vec<RepositoryCommit>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCommit {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub author: RepositoryCommitIdentity,
    pub committer: RepositoryCommitIdentity,
    pub signature: RepositorySignature,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCommitIdentity {
    pub name: String,
    pub email: String,
    pub date: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct TrustedGpgKey {
    pub key_id: String,
    pub fingerprint: String,
    pub public_key: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositorySignature {
    pub state: RepositorySignatureState,
    pub key_id: String,
    pub fingerprint: String,
    pub primary_key_fingerprint: String,
    pub signer: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepositorySignatureState {
    Unsigned,
    Valid,
    Trusted,
    Untrusted,
    Bad,
    Unknown,
    Expired,
    Revoked,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryTreeEntry {
    pub name: String,
    pub object_id: String,
    pub kind: RepositoryTreeEntryKind,
    pub size_bytes: u64,
    pub path: String,
    pub mode: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepositoryTreeEntryKind {
    File,
    Directory,
    Symlink,
    Submodule,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryReadme {
    pub filename: String,
    pub object_id: String,
    pub content: Vec<u8>,
    pub is_truncated: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepositoryBlobPreview {
    Text {
        object_id: String,
        text: String,
        size_bytes: u64,
        preview_limit_bytes: u64,
    },
    Binary {
        object_id: String,
        size_bytes: u64,
        preview_limit_bytes: u64,
    },
    TooLarge {
        object_id: String,
        size_bytes: u64,
        preview_limit_bytes: u64,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryRawBlob {
    pub object_id: String,
    pub content: Vec<u8>,
    pub size_bytes: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryComparison {
    pub base_sha: String,
    pub head_sha: String,
    pub merge_base_sha: String,
    pub commits: Vec<RepositoryComparisonCommit>,
    pub files: Vec<RepositoryChangedFile>,
    pub is_truncated: bool,
    pub file_limit: u32,
    pub commits_truncated: bool,
    pub commit_limit: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryComparisonCommit {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    pub author: RepositoryCommitIdentity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryChangedFile {
    pub status: RepositoryChangedFileStatus,
    pub old_path: String,
    pub new_path: String,
    pub base_blob_id: String,
    pub head_blob_id: String,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RepositoryChangedFileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryFileDiff {
    pub base_sha: String,
    pub head_sha: String,
    pub merge_base_sha: String,
    pub file: RepositoryChangedFile,
    pub hunks: Vec<RepositoryDiffHunk>,
    pub is_truncated: bool,
    pub patch_limit_bytes: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryDiffHunk {
    pub header: String,
    pub lines: Vec<RepositoryDiffLine>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryDiffLine {
    pub kind: RepositoryDiffLineKind,
    pub content: String,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum RepositoryDiffLineKind {
    Context,
    Addition,
    Deletion,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryMerge {
    pub merge_commit_sha: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryMergeability {
    pub mergeable: bool,
    pub base_sha: String,
    pub head_sha: String,
    pub merge_base_sha: String,
    pub conflict_paths: Vec<String>,
    pub conflict_paths_truncated: bool,
    pub conflict_path_limit: u32,
}
