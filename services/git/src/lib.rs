pub mod config;
pub mod domain;
pub mod smart_http;
pub mod ssh;
pub mod storage;

pub mod proto {
    tonic::include_proto!("tessera.git.v1");
}

pub use config::Config;
pub use domain::{
    RepositoryBlobPreview, RepositoryBrowserSummary, RepositoryChangedFile,
    RepositoryChangedFileStatus, RepositoryCommit, RepositoryCommitIdentity, RepositoryCommitList,
    RepositoryComparison, RepositoryComparisonCommit, RepositoryCreated, RepositoryDiffHunk,
    RepositoryDiffLine, RepositoryDiffLineKind, RepositoryError, RepositoryFileDiff, RepositoryId,
    RepositoryMerge, RepositoryMergeability, RepositoryRawBlob, RepositoryReadme, RepositoryRef,
    RepositoryRefKind, RepositoryRefList, RepositorySignature, RepositorySignatureState,
    RepositoryTree, RepositoryTreeEntry, RepositoryTreeEntryKind, TrustedGpgKey,
};
pub use storage::{GitStorageApplication, GitStorageGrpcService, RepositoryStorage};
