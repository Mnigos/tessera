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
