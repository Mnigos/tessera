use std::path::PathBuf;

/// Where Tessera keeps refs of its own inside a user's repository. Nothing under
/// it is part of the repository's contents: it exists so the service can leave
/// durable evidence next to the objects it wrote.
pub const TESSERA_REF_NAMESPACE: &str = "refs/tessera";

/// Keeps that namespace out of Git transport entirely.
///
/// `transfer.hideRefs` is read by both upload-pack and receive-pack, so the refs
/// are neither advertised to a client that fetches nor writable by one that
/// pushes — Git rejects an update to a hidden ref outright. Both transports
/// inject it per command, the way the hook path is injected, and never write it
/// into a repository's own configuration, so the service's own plumbing still
/// sees what it filed.
pub const HIDDEN_REFS_CONFIG_ARGUMENT: &str = "transfer.hideRefs=refs/tessera";

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
    pub commit_count: u64,
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
    /// Where the target branch was left. Only `MergeCommit` guarantees this is a
    /// merge commit; a fast-forward leaves it equal to the source head.
    pub resulting_sha: String,
}

/// How a pull request's commits are put on its target branch. The set is closed:
/// every strategy has its own object-building rules and its own availability
/// answer, and the two must always be decided together.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepositoryMergeStrategy {
    MergeCommit,
    Squash,
    Rebase,
    FastForward,
}

impl RepositoryMergeStrategy {
    pub(crate) fn as_receipt_name(self) -> &'static str {
        match self {
            Self::MergeCommit => "merge_commit",
            Self::Squash => "squash",
            Self::Rebase => "rebase",
            Self::FastForward => "fast_forward",
        }
    }

    pub(crate) fn from_receipt_name(value: &str) -> Option<Self> {
        match value {
            "merge_commit" => Some(Self::MergeCommit),
            "squash" => Some(Self::Squash),
            "rebase" => Some(Self::Rebase),
            "fast_forward" => Some(Self::FastForward),
            _ => None,
        }
    }
}

/// Why a strategy cannot run against the current pair of tips. Distinct from a
/// conflict on purpose: ancestry and an empty replay are facts about the shape
/// of the history, not about the content of the files.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RepositoryMergeStrategyUnavailableReason {
    Conflict,
    NotFastForward,
    AlreadyUpToDate,
    NothingToRebase,
    UnsupportedHistory,
}

impl RepositoryMergeStrategyUnavailableReason {
    /// The wire name. It travels in the gRPC status message of a refused merge,
    /// which the API parses back into its own blocking reason, so changing one
    /// of these means changing the API's reader in the same commit.
    pub fn as_name(self) -> &'static str {
        match self {
            Self::Conflict => "conflict",
            Self::NotFastForward => "not_fast_forward",
            Self::AlreadyUpToDate => "already_up_to_date",
            Self::NothingToRebase => "nothing_to_rebase",
            Self::UnsupportedHistory => "unsupported_history",
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryMergeStrategyAvailability {
    pub strategy: RepositoryMergeStrategy,
    pub available: bool,
    pub reason: Option<RepositoryMergeStrategyUnavailableReason>,
}

/// Everything one merge needs, named rather than positional: the strategies
/// share most of these and disagree about which of the rest they read.
#[derive(Clone, Copy, Debug)]
pub struct RepositoryMergeRequest<'a> {
    pub repository_id: &'a str,
    pub storage_path: &'a str,
    pub base_ref: &'a str,
    pub head_ref: &'a str,
    pub expected_base_sha: &'a str,
    pub expected_head_sha: &'a str,
    pub author_name: &'a str,
    pub author_email: &'a str,
    /// Read by `MergeCommit` alone.
    pub message: &'a str,
    /// Read by `Squash` alone.
    pub squash_title: &'a str,
    /// Read by `Squash` alone.
    pub squash_body: &'a str,
    pub strategy: RepositoryMergeStrategy,
    /// A UUID: it names the operation receipt's ref, and a retry is recognised
    /// by finding that ref already filed.
    pub operation_id: &'a str,
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
    /// One entry per strategy, always complete.
    pub strategy_availability: Vec<RepositoryMergeStrategyAvailability>,
}
