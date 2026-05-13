use async_trait::async_trait;
use bytes::Bytes;
use http::{HeaderMap, Method};

use crate::domain::RepositoryError;
use crate::smart_http::domain::{SmartHttpAction, SmartHttpError, SmartHttpRepositoryMetadata};
use crate::smart_http::infrastructure::{GitHttpBackend, GitHttpBackendRequest};
use crate::storage::infrastructure::RepositoryStorage;

#[async_trait]
pub trait SmartHttpAuthorizer: Clone + Send + Sync + 'static {
    async fn authorize(
        &self,
        request: SmartHttpAuthorizationRequest,
    ) -> Result<SmartHttpRepositoryMetadata, SmartHttpError>;
}

#[derive(Clone, Debug)]
pub struct SmartHttpAuthorizationRequest {
    pub username: String,
    pub repo_slug: String,
    pub action: SmartHttpAction,
}

#[derive(Clone, Debug)]
pub struct SmartHttpApplication<A> {
    authorizer: A,
    storage: RepositoryStorage,
    backend: GitHttpBackend,
}

impl<A> SmartHttpApplication<A>
where
    A: SmartHttpAuthorizer,
{
    pub fn new(authorizer: A, storage: RepositoryStorage, backend: GitHttpBackend) -> Self {
        Self {
            authorizer,
            storage,
            backend,
        }
    }

    pub async fn handle(
        &self,
        request: SmartHttpRequest,
    ) -> Result<SmartHttpResponse, SmartHttpError> {
        let parsed = parse_smart_http_request(&request.method, &request.path, &request.query)?;
        let metadata = self
            .authorizer
            .authorize(SmartHttpAuthorizationRequest {
                username: request.username,
                repo_slug: request.repo_slug,
                action: parsed.action,
            })
            .await?;
        let repository_path = self
            .storage
            .existing_bare_repository_path(&metadata.repository_id, &metadata.storage_path)
            .await
            .map_err(storage_error_to_smart_http_error)?;

        self.backend
            .execute(GitHttpBackendRequest {
                repository_path,
                method: request.method,
                path: parsed.cgi_path,
                query: request.query,
                content_type: request
                    .headers
                    .get(http::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string),
                body: request.body,
            })
            .await
    }
}

#[derive(Debug)]
pub struct SmartHttpRequest {
    pub username: String,
    pub repo_slug: String,
    pub method: Method,
    pub path: String,
    pub query: Option<String>,
    pub headers: HeaderMap,
    pub body: Bytes,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SmartHttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Bytes,
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedSmartHttpRequest {
    action: SmartHttpAction,
    cgi_path: String,
}

fn parse_smart_http_request(
    method: &Method,
    path: &str,
    query: &Option<String>,
) -> Result<ParsedSmartHttpRequest, SmartHttpError> {
    if path == "info/refs" {
        if method != Method::GET {
            return Err(SmartHttpError::UnsupportedMethod);
        }

        let service = query_service(query).ok_or(SmartHttpError::UnsupportedService)?;

        return match service.as_str() {
            "git-upload-pack" => Ok(ParsedSmartHttpRequest {
                action: SmartHttpAction::InfoRefs,
                cgi_path: "/info/refs".to_string(),
            }),
            "git-receive-pack" => Err(SmartHttpError::PushRejected),
            _ => Err(SmartHttpError::UnsupportedService),
        };
    }

    if path == "git-upload-pack" {
        if method != Method::POST {
            return Err(SmartHttpError::UnsupportedMethod);
        }

        return Ok(ParsedSmartHttpRequest {
            action: SmartHttpAction::UploadPack,
            cgi_path: "/git-upload-pack".to_string(),
        });
    }

    if path == "git-receive-pack" {
        return Err(SmartHttpError::PushRejected);
    }

    Err(SmartHttpError::InvalidPath)
}

fn query_service(query: &Option<String>) -> Option<String> {
    let query = query.as_ref()?;

    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;

        (key == "service").then(|| value.to_string())
    })
}

fn storage_error_to_smart_http_error(error: RepositoryError) -> SmartHttpError {
    match error {
        RepositoryError::InvalidRepositoryId => SmartHttpError::InvalidRepositoryMetadata,
        RepositoryError::PathEscapesStorageRoot
        | RepositoryError::ExistingPathNotBare
        | RepositoryError::StoragePathMismatch
        | RepositoryError::StorageIo(_) => SmartHttpError::RepositoryUnavailable,
        RepositoryError::GitProcessIo(_) | RepositoryError::GitProcessFailed => {
            SmartHttpError::BackendFailed
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upload_pack_info_refs() {
        let parsed = parse_smart_http_request(
            &Method::GET,
            "info/refs",
            &Some("service=git-upload-pack".to_string()),
        )
        .unwrap();

        assert_eq!(parsed.action, SmartHttpAction::InfoRefs);
        assert_eq!(parsed.cgi_path, "/info/refs");
    }

    #[test]
    fn parses_upload_pack_post() {
        let parsed = parse_smart_http_request(&Method::POST, "git-upload-pack", &None).unwrap();

        assert_eq!(parsed.action, SmartHttpAction::UploadPack);
        assert_eq!(parsed.cgi_path, "/git-upload-pack");
    }

    #[test]
    fn rejects_receive_pack_push() {
        let error = parse_smart_http_request(
            &Method::GET,
            "info/refs",
            &Some("service=git-receive-pack".to_string()),
        )
        .unwrap_err();

        assert_eq!(error, SmartHttpError::PushRejected);
    }
}
