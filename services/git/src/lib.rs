pub mod config;
pub mod domain;
pub mod smart_http;
pub mod storage;

pub mod proto {
    tonic::include_proto!("tessera.git.v1");
}

pub use config::Config;
pub use domain::{
    RepositoryBlobPreview, RepositoryBrowserSummary, RepositoryCreated, RepositoryError,
    RepositoryId, RepositoryReadme, RepositoryTree, RepositoryTreeEntry, RepositoryTreeEntryKind,
};
pub use storage::{GitStorageApplication, GitStorageGrpcService, RepositoryStorage};
