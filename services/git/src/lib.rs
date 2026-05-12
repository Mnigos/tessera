pub mod application;
pub mod config;
pub mod domain;
pub mod grpc;
pub mod infrastructure;

pub mod proto {
    tonic::include_proto!("tessera.git.v1");
}

pub use application::GitStorageApplication;
pub use config::Config;
pub use domain::{RepositoryCreated, RepositoryError, RepositoryId};
pub use grpc::GitStorageGrpcService;
pub use infrastructure::RepositoryStorage;
