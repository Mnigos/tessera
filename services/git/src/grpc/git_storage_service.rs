use crate::application::GitStorageApplication;
use crate::config::Config;
use crate::domain::RepositoryError;
use crate::infrastructure::RepositoryStorage;
use crate::proto::git_storage_service_server::GitStorageService;
use crate::proto::{
    CreateRepositoryRequest, CreateRepositoryResponse, HealthRequest, HealthResponse,
};
use tonic::{Request, Response, Status};

#[derive(Clone, Debug)]
pub struct GitStorageGrpcService {
    application: GitStorageApplication,
}

impl GitStorageGrpcService {
    pub fn new(config: Config) -> Self {
        let storage = RepositoryStorage::new(config.storage_root, config.git_binary);

        Self {
            application: GitStorageApplication::new(storage),
        }
    }
}

#[tonic::async_trait]
impl GitStorageService for GitStorageGrpcService {
    async fn health(
        &self,
        _request: Request<HealthRequest>,
    ) -> Result<Response<HealthResponse>, Status> {
        Ok(Response::new(HealthResponse {
            status: self.application.health().to_string(),
        }))
    }

    async fn create_repository(
        &self,
        request: Request<CreateRepositoryRequest>,
    ) -> Result<Response<CreateRepositoryResponse>, Status> {
        let repository = self
            .application
            .create_repository(&request.into_inner().repository_id)
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(CreateRepositoryResponse {
            storage_path: repository.path.display().to_string(),
        }))
    }
}

fn repository_error_to_status(error: RepositoryError) -> Status {
    match error {
        RepositoryError::InvalidRepositoryId => {
            Status::invalid_argument("repository_id must be an opaque UUID")
        }
        RepositoryError::PathEscapesStorageRoot => {
            Status::internal("repository storage path failed safety validation")
        }
        RepositoryError::ExistingPathNotBare => {
            Status::failed_precondition("repository path exists but is not a bare git repository")
        }
        RepositoryError::StorageIo(_)
        | RepositoryError::GitProcessIo(_)
        | RepositoryError::GitProcessFailed => {
            Status::internal("repository could not be initialized")
        }
    }
}
