use crate::config::Config;
use crate::domain::{RepositoryError, RepositoryTreeEntryKind};
use crate::proto::git_storage_service_server::GitStorageService;
use crate::proto::{
    CreateRepositoryRequest, CreateRepositoryResponse, GetRepositoryBrowserSummaryRequest,
    GetRepositoryBrowserSummaryResponse, HealthRequest, HealthResponse, RepositoryReadme,
    RepositoryTreeEntry, RepositoryTreeEntryKind as ProtoRepositoryTreeEntryKind,
};
use crate::storage::application::GitStorageApplication;
use crate::storage::infrastructure::RepositoryStorage;
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
            storage_path: repository.storage_path,
        }))
    }

    async fn get_repository_browser_summary(
        &self,
        request: Request<GetRepositoryBrowserSummaryRequest>,
    ) -> Result<Response<GetRepositoryBrowserSummaryResponse>, Status> {
        let request = request.into_inner();
        let summary = self
            .application
            .get_repository_browser_summary(
                &request.repository_id,
                &request.storage_path,
                &request.default_branch,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryBrowserSummaryResponse {
            is_empty: summary.is_empty,
            default_branch: summary.default_branch,
            root_entries: summary
                .root_entries
                .into_iter()
                .map(|entry| RepositoryTreeEntry {
                    name: entry.name,
                    object_id: entry.object_id,
                    kind: proto_tree_entry_kind(entry.kind).into(),
                    size_bytes: entry.size_bytes,
                    path: entry.path,
                    mode: entry.mode,
                })
                .collect(),
            readme: summary.readme.map(|readme| RepositoryReadme {
                filename: readme.filename,
                object_id: readme.object_id,
                content: readme.content,
                is_truncated: readme.is_truncated,
            }),
        }))
    }
}

fn repository_error_to_status(error: RepositoryError) -> Status {
    match error {
        RepositoryError::InvalidRepositoryId => {
            Status::invalid_argument("repository_id must be an opaque UUID")
        }
        RepositoryError::InvalidRepositoryPath => {
            Status::invalid_argument("repository path is invalid")
        }
        RepositoryError::InvalidRepositoryRef => {
            Status::invalid_argument("repository default branch is invalid")
        }
        RepositoryError::InvalidGitOutput => Status::internal("git returned invalid output"),
        RepositoryError::PathEscapesStorageRoot => {
            Status::internal("repository storage path failed safety validation")
        }
        RepositoryError::ExistingPathNotBare => {
            Status::failed_precondition("repository path exists but is not a bare git repository")
        }
        RepositoryError::StoragePathMismatch => {
            Status::failed_precondition("repository storage path does not match storage root")
        }
        RepositoryError::StorageIo(_)
        | RepositoryError::GitProcessIo(_)
        | RepositoryError::GitProcessFailed => Status::internal("repository git operation failed"),
    }
}

fn proto_tree_entry_kind(kind: RepositoryTreeEntryKind) -> ProtoRepositoryTreeEntryKind {
    match kind {
        RepositoryTreeEntryKind::File => ProtoRepositoryTreeEntryKind::File,
        RepositoryTreeEntryKind::Directory => ProtoRepositoryTreeEntryKind::Directory,
        RepositoryTreeEntryKind::Symlink => ProtoRepositoryTreeEntryKind::Symlink,
        RepositoryTreeEntryKind::Submodule => ProtoRepositoryTreeEntryKind::Submodule,
    }
}
