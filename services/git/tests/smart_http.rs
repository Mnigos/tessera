use std::path::{Path, PathBuf};

use async_trait::async_trait;
use bytes::Bytes;
use http::{HeaderMap, Method};
use tempfile::TempDir;
use tessera_git::RepositoryId;
use tessera_git::smart_http::application::{
    SmartHttpApplication, SmartHttpAuthorizationRequest, SmartHttpAuthorizer, SmartHttpRequest,
};
use tessera_git::smart_http::domain::{
    BasicCredentials, SmartHttpError, SmartHttpRepositoryMetadata,
};
use tessera_git::smart_http::infrastructure::GitHttpBackend;
use tessera_git::storage::infrastructure::RepositoryStorage;

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";
const MISSING_GIT_BINARY: &str = "/definitely/missing/tessera/git-http-backend-test/git-binary";

#[tokio::test]
async fn smart_http_rejects_invalid_repository_metadata_before_backend() {
    let temp_dir = TempDir::new().unwrap();
    let application = application(temp_dir.path(), "git", "not-a-uuid");

    let error = application.handle(info_refs_request()).await.unwrap_err();

    assert_eq!(error, SmartHttpError::InvalidRepositoryMetadata);
}

#[tokio::test]
async fn smart_http_maps_backend_failure() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    storage.create_repository(&repository_id()).await.unwrap();
    let application = application(temp_dir.path(), MISSING_GIT_BINARY, REPOSITORY_ID);

    let error = application.handle(info_refs_request()).await.unwrap_err();

    assert_eq!(error, SmartHttpError::BackendFailed);
}

#[tokio::test]
async fn smart_http_rejects_storage_path_mismatch() {
    let temp_dir = TempDir::new().unwrap();
    let repository_storage = storage(temp_dir.path(), "git");
    repository_storage
        .create_repository(&repository_id())
        .await
        .unwrap();
    let application = SmartHttpApplication::new(
        FakeAuthorizer {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: temp_dir
                .path()
                .join("repositories")
                .join("different.git")
                .display()
                .to_string(),
        },
        repository_storage,
        GitHttpBackend::new(PathBuf::from("git")),
    );

    let error = application.handle(info_refs_request()).await.unwrap_err();

    assert_eq!(error, SmartHttpError::RepositoryUnavailable);
}

#[tokio::test]
async fn smart_http_serves_upload_pack_info_refs() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    storage.create_repository(&repository_id()).await.unwrap();
    let application = application(temp_dir.path(), "git", REPOSITORY_ID);

    let response = application.handle(info_refs_request()).await.unwrap();

    assert_eq!(response.status, 200);
    assert!(response.headers.iter().any(|(name, value)| {
        name.eq_ignore_ascii_case("Content-Type")
            && value.starts_with("application/x-git-upload-pack-advertisement")
    }));
    assert!(
        response
            .body
            .windows(15)
            .any(|window| window == b"git-upload-pack")
    );
}

#[tokio::test]
async fn smart_http_rejects_receive_pack_without_credentials_before_backend() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    storage.create_repository(&repository_id()).await.unwrap();
    let application = application(temp_dir.path(), MISSING_GIT_BINARY, REPOSITORY_ID);

    let error = application
        .handle(receive_pack_request(None))
        .await
        .unwrap_err();

    assert_eq!(error, SmartHttpError::MissingCredentials);
}

#[tokio::test]
async fn smart_http_authorizes_receive_pack_before_backend() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    storage.create_repository(&repository_id()).await.unwrap();
    let application = application(temp_dir.path(), MISSING_GIT_BINARY, REPOSITORY_ID);

    let error = application
        .handle(receive_pack_request(Some(BasicCredentials {
            username: "mona".to_string(),
            token: "token".to_string(),
        })))
        .await
        .unwrap_err();

    assert_eq!(error, SmartHttpError::BackendFailed);
}

fn application(
    storage_root: &Path,
    git_binary: &str,
    repository_id: &str,
) -> SmartHttpApplication<FakeAuthorizer> {
    SmartHttpApplication::new(
        FakeAuthorizer {
            repository_id: repository_id.to_string(),
            storage_path: repository_storage_path(storage_root, repository_id),
        },
        storage(storage_root, git_binary),
        GitHttpBackend::new(PathBuf::from(git_binary)),
    )
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

fn info_refs_request() -> SmartHttpRequest {
    SmartHttpRequest {
        username: "mona".to_string(),
        repo_slug: "repo".to_string(),
        method: Method::GET,
        path: "info/refs".to_string(),
        query: Some("service=git-upload-pack".to_string()),
        headers: HeaderMap::new(),
        body: Bytes::new(),
        basic_credentials: None,
    }
}

fn receive_pack_request(basic_credentials: Option<BasicCredentials>) -> SmartHttpRequest {
    SmartHttpRequest {
        username: "mona".to_string(),
        repo_slug: "repo".to_string(),
        method: Method::POST,
        path: "git-receive-pack".to_string(),
        query: None,
        headers: HeaderMap::new(),
        body: Bytes::new(),
        basic_credentials,
    }
}

fn repository_id() -> RepositoryId {
    RepositoryId::parse(REPOSITORY_ID).unwrap()
}

fn repository_storage_path(storage_root: &Path, repository_id: &str) -> String {
    storage_root
        .join("repositories")
        .join(format!("{repository_id}.git"))
        .display()
        .to_string()
}

#[derive(Clone)]
struct FakeAuthorizer {
    repository_id: String,
    storage_path: String,
}

#[async_trait]
impl SmartHttpAuthorizer for FakeAuthorizer {
    async fn authorize(
        &self,
        _request: SmartHttpAuthorizationRequest,
    ) -> Result<SmartHttpRepositoryMetadata, SmartHttpError> {
        Ok(SmartHttpRepositoryMetadata {
            repository_id: self.repository_id.clone(),
            storage_path: self.storage_path.clone(),
            authenticated_username: Some("mona".to_string()),
        })
    }
}
