use std::path::{Path, PathBuf};

use async_trait::async_trait;
use tempfile::TempDir;
use tessera_git::RepositoryId;
use tessera_git::ssh::infrastructure::GitSshBackend;
use tessera_git::ssh::{
    SshAuthenticatedKey, SshGitApplication, SshGitAuthenticationRequest,
    SshGitAuthorizationRequest, SshGitAuthorizer, SshGitError, SshGitOperation,
    SshRepositoryMetadata, authorization_request, parse_ssh_git_command,
};
use tessera_git::storage::infrastructure::RepositoryStorage;

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";

#[test]
fn ssh_command_parser_accepts_git_services() {
    let upload = parse_ssh_git_command("git-upload-pack mona/repo.git").unwrap();
    let receive = parse_ssh_git_command("git-receive-pack 'mona/repo.git'").unwrap();

    assert_eq!(upload.owner, "mona");
    assert_eq!(upload.repository, "repo");
    assert_eq!(upload.operation, SshGitOperation::UploadPack);
    assert_eq!(receive.operation, SshGitOperation::ReceivePack);
}

#[test]
fn ssh_command_parser_rejects_unsafe_or_unsupported_commands() {
    for input in [
        "git-upload-pack mona/repo",
        "git-upload-pack ../repo.git",
        "git-upload-pack mona/repo.git extra",
        "git-upload-archive mona/repo.git",
        "git-upload-pack 'mona/repo.git' extra",
    ] {
        assert!(parse_ssh_git_command(input).is_err(), "{input}");
    }
}

#[tokio::test]
async fn ssh_authorization_uses_fingerprint_repository_and_operation() {
    let command = parse_ssh_git_command("git-receive-pack mona/repo.git").unwrap();
    let request = authorization_request("git".to_string(), "SHA256:abc123".to_string(), command);

    assert_eq!(
        request,
        SshGitAuthorizationRequest {
            username: "git".to_string(),
            public_key_fingerprint: "SHA256:abc123".to_string(),
            owner: "mona".to_string(),
            repository: "repo".to_string(),
            operation: SshGitOperation::ReceivePack,
        }
    );
}

#[tokio::test]
async fn ssh_application_resolves_authorized_repository_through_storage_guard() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage
        .create_repository(&RepositoryId::parse(REPOSITORY_ID).unwrap())
        .await
        .unwrap();
    let application = SshGitApplication::new(
        FakeSshAuthorizer {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path,
        },
        storage,
        GitSshBackend::new(PathBuf::from("git")),
    );

    let authorized = application
        .authorize(SshGitAuthorizationRequest {
            username: "git".to_string(),
            public_key_fingerprint: "SHA256:abc123".to_string(),
            owner: "mona".to_string(),
            repository: "repo".to_string(),
            operation: SshGitOperation::UploadPack,
        })
        .await
        .unwrap();

    assert_eq!(authorized.operation, SshGitOperation::UploadPack);
    assert_eq!(
        authorized.repository_path,
        temp_dir
            .path()
            .join("repositories")
            .join(format!("{REPOSITORY_ID}.git"))
    );
}

#[tokio::test]
async fn ssh_application_rejects_authorized_storage_path_mismatch() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    storage
        .create_repository(&RepositoryId::parse(REPOSITORY_ID).unwrap())
        .await
        .unwrap();
    let application = SshGitApplication::new(
        FakeSshAuthorizer {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: temp_dir
                .path()
                .join("repositories")
                .join("different.git")
                .display()
                .to_string(),
        },
        storage,
        GitSshBackend::new(PathBuf::from("git")),
    );

    let error = application
        .authorize(SshGitAuthorizationRequest {
            username: "git".to_string(),
            public_key_fingerprint: "SHA256:abc123".to_string(),
            owner: "mona".to_string(),
            repository: "repo".to_string(),
            operation: SshGitOperation::UploadPack,
        })
        .await
        .unwrap_err();

    assert_eq!(error, SshGitError::RepositoryUnavailable);
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

#[derive(Clone)]
struct FakeSshAuthorizer {
    repository_id: String,
    storage_path: String,
}

#[async_trait]
impl SshGitAuthorizer for FakeSshAuthorizer {
    async fn authenticate_public_key(
        &self,
        _request: SshGitAuthenticationRequest,
    ) -> Result<SshAuthenticatedKey, SshGitError> {
        Ok(SshAuthenticatedKey {
            trusted_user: "00000000-0000-4000-8000-000000000001".to_string(),
        })
    }

    async fn authorize(
        &self,
        _request: SshGitAuthorizationRequest,
    ) -> Result<SshRepositoryMetadata, SshGitError> {
        Ok(SshRepositoryMetadata {
            repository_id: self.repository_id.clone(),
            storage_path: self.storage_path.clone(),
        })
    }
}
