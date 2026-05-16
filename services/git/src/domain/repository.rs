use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCreated {
    pub path: PathBuf,
    pub storage_path: String,
    pub created: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryBrowserSummary {
    pub is_empty: bool,
    pub default_branch: String,
    pub root_entries: Vec<RepositoryTreeEntry>,
    pub readme: Option<RepositoryReadme>,
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
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCommitIdentity {
    pub name: String,
    pub email: String,
    pub date: String,
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
