use crate::config::Config;
use crate::domain::{
    RepositoryBlobPreview, RepositoryCommitIdentity as DomainRepositoryCommitIdentity,
    RepositoryError, RepositoryTreeEntryKind,
};
use crate::proto::git_storage_service_server::GitStorageService;
use crate::proto::{
    CreateRepositoryRequest, CreateRepositoryResponse, GetRepositoryBlobRequest,
    GetRepositoryBlobResponse, GetRepositoryBrowserSummaryRequest,
    GetRepositoryBrowserSummaryResponse, GetRepositoryRawBlobRequest, GetRepositoryRawBlobResponse,
    GetRepositoryTreeRequest, GetRepositoryTreeResponse, HealthRequest, HealthResponse,
    ListRepositoryCommitsRequest, ListRepositoryCommitsResponse,
    RepositoryBlobPreviewState as ProtoRepositoryBlobPreviewState, RepositoryCommit,
    RepositoryCommitIdentity, RepositoryReadme, RepositoryTreeEntry,
    RepositoryTreeEntryKind as ProtoRepositoryTreeEntryKind,
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

    async fn get_repository_tree(
        &self,
        request: Request<GetRepositoryTreeRequest>,
    ) -> Result<Response<GetRepositoryTreeResponse>, Status> {
        let request = request.into_inner();
        let tree = self
            .application
            .get_repository_tree(
                &request.repository_id,
                &request.storage_path,
                &request.r#ref,
                &request.path,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryTreeResponse {
            commit_id: tree.commit_id,
            path: tree.path,
            entries: tree
                .entries
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
        }))
    }

    async fn get_repository_blob(
        &self,
        request: Request<GetRepositoryBlobRequest>,
    ) -> Result<Response<GetRepositoryBlobResponse>, Status> {
        let request = request.into_inner();
        let blob = self
            .application
            .get_repository_blob(
                &request.repository_id,
                &request.storage_path,
                &request.object_id,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(proto_blob_preview(blob)))
    }

    async fn get_repository_raw_blob(
        &self,
        request: Request<GetRepositoryRawBlobRequest>,
    ) -> Result<Response<GetRepositoryRawBlobResponse>, Status> {
        let request = request.into_inner();
        let blob = self
            .application
            .get_repository_raw_blob(
                &request.repository_id,
                &request.storage_path,
                &request.object_id,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(GetRepositoryRawBlobResponse {
            object_id: blob.object_id,
            content: blob.content,
            size_bytes: blob.size_bytes,
        }))
    }

    async fn list_repository_commits(
        &self,
        request: Request<ListRepositoryCommitsRequest>,
    ) -> Result<Response<ListRepositoryCommitsResponse>, Status> {
        let request = request.into_inner();
        let commit_list = self
            .application
            .list_repository_commits(
                &request.repository_id,
                &request.storage_path,
                &request.r#ref,
                request.limit,
            )
            .await
            .map_err(repository_error_to_status)?;

        Ok(Response::new(ListRepositoryCommitsResponse {
            commits: commit_list
                .commits
                .into_iter()
                .map(|commit| RepositoryCommit {
                    sha: commit.sha,
                    short_sha: commit.short_sha,
                    summary: commit.summary,
                    author: Some(proto_commit_identity(commit.author)),
                    committer: Some(proto_commit_identity(commit.committer)),
                })
                .collect(),
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
        RepositoryError::InvalidObjectId => Status::invalid_argument("object_id is invalid"),
        RepositoryError::InvalidGitOutput => Status::internal("git returned invalid output"),
        RepositoryError::BlobTooLarge => Status::resource_exhausted("repository blob is too large"),
        RepositoryError::RepositoryObjectNotFound => {
            Status::not_found("repository object was not found")
        }
        RepositoryError::WrongObjectKind => {
            Status::failed_precondition("repository object has the wrong kind")
        }
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

fn proto_blob_preview(blob: RepositoryBlobPreview) -> GetRepositoryBlobResponse {
    match blob {
        RepositoryBlobPreview::Text {
            object_id,
            text,
            size_bytes,
            preview_limit_bytes,
        } => GetRepositoryBlobResponse {
            object_id,
            state: ProtoRepositoryBlobPreviewState::Text.into(),
            text,
            size_bytes,
            preview_limit_bytes,
        },
        RepositoryBlobPreview::Binary {
            object_id,
            size_bytes,
            preview_limit_bytes,
        } => GetRepositoryBlobResponse {
            object_id,
            state: ProtoRepositoryBlobPreviewState::Binary.into(),
            text: String::new(),
            size_bytes,
            preview_limit_bytes,
        },
        RepositoryBlobPreview::TooLarge {
            object_id,
            size_bytes,
            preview_limit_bytes,
        } => GetRepositoryBlobResponse {
            object_id,
            state: ProtoRepositoryBlobPreviewState::TooLarge.into(),
            text: String::new(),
            size_bytes,
            preview_limit_bytes,
        },
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

fn proto_commit_identity(identity: DomainRepositoryCommitIdentity) -> RepositoryCommitIdentity {
    RepositoryCommitIdentity {
        name: identity.name,
        email: identity.email,
        date: identity.date,
    }
}
