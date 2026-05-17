use async_trait::async_trait;
use std::path::PathBuf;

use crate::domain::RepositoryError;
use crate::ssh::domain::{SshGitCommand, SshGitError, SshGitOperation, SshRepositoryMetadata};
use crate::ssh::infrastructure::{GitSshBackend, GitSshBackendRequest};
use crate::storage::infrastructure::RepositoryStorage;

#[async_trait]
pub trait SshGitAuthorizer: Clone + Send + Sync + 'static {
    async fn authenticate_public_key(
        &self,
        request: SshGitAuthenticationRequest,
    ) -> Result<SshAuthenticatedKey, SshGitError>;

    async fn authorize(
        &self,
        request: SshGitAuthorizationRequest,
    ) -> Result<SshRepositoryMetadata, SshGitError>;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshGitAuthenticationRequest {
    pub username: String,
    pub public_key_fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshAuthenticatedKey {
    pub trusted_user: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshGitAuthorizationRequest {
    pub username: String,
    pub public_key_fingerprint: String,
    pub owner: String,
    pub repository: String,
    pub operation: SshGitOperation,
}

#[derive(Clone, Debug)]
pub struct SshGitApplication<A> {
    authorizer: A,
    storage: RepositoryStorage,
    backend: GitSshBackend,
}

impl<A> SshGitApplication<A>
where
    A: SshGitAuthorizer,
{
    pub fn new(authorizer: A, storage: RepositoryStorage, backend: GitSshBackend) -> Self {
        Self {
            authorizer,
            storage,
            backend,
        }
    }

    pub async fn authorize(
        &self,
        request: SshGitAuthorizationRequest,
    ) -> Result<AuthorizedSshGitCommand, SshGitError> {
        let operation = request.operation;
        let metadata = self.authorizer.authorize(request).await?;
        let repository_path = self
            .storage
            .existing_bare_repository_path(&metadata.repository_id, &metadata.storage_path)
            .await
            .map_err(storage_error_to_ssh_error)?;

        Ok(AuthorizedSshGitCommand {
            operation,
            repository_path,
        })
    }

    pub async fn authenticate_public_key(
        &self,
        request: SshGitAuthenticationRequest,
    ) -> Result<SshAuthenticatedKey, SshGitError> {
        self.authorizer.authenticate_public_key(request).await
    }

    pub async fn execute(&self, command: AuthorizedSshGitCommand) -> Result<(), SshGitError> {
        self.backend
            .execute(GitSshBackendRequest {
                operation: command.operation,
                repository_path: command.repository_path,
            })
            .await
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AuthorizedSshGitCommand {
    pub operation: SshGitOperation,
    pub repository_path: PathBuf,
}

pub fn authorization_request(
    username: String,
    public_key_fingerprint: String,
    command: SshGitCommand,
) -> SshGitAuthorizationRequest {
    SshGitAuthorizationRequest {
        username,
        public_key_fingerprint,
        owner: command.owner,
        repository: command.repository,
        operation: command.operation,
    }
}

fn storage_error_to_ssh_error(error: RepositoryError) -> SshGitError {
    match error {
        RepositoryError::InvalidRepositoryId
        | RepositoryError::InvalidRepositoryPath
        | RepositoryError::InvalidRepositoryRef
        | RepositoryError::InvalidObjectId => SshGitError::InvalidRepositoryMetadata,
        RepositoryError::PathEscapesStorageRoot
        | RepositoryError::ExistingPathNotBare
        | RepositoryError::StoragePathMismatch
        | RepositoryError::RepositoryObjectNotFound
        | RepositoryError::WrongObjectKind
        | RepositoryError::BlobTooLarge
        | RepositoryError::StorageIo(_)
        | RepositoryError::InvalidGitOutput => SshGitError::RepositoryUnavailable,
        RepositoryError::GitProcessIo(_) | RepositoryError::GitProcessFailed => {
            SshGitError::BackendFailed
        }
    }
}
