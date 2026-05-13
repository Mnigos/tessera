use async_trait::async_trait;
use axum::body::Body;
use bytes::Bytes;
use http::{HeaderMap, Method};

use crate::domain::RepositoryError;
use crate::smart_http::domain::{
    BasicCredentials, SmartHttpAction, SmartHttpError, SmartHttpRepositoryMetadata, query_service,
};
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
    pub basic_credentials: Option<BasicCredentials>,
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
        let authorized = self
            .authorize(SmartHttpAuthorizationContext {
                username: request.username.clone(),
                repo_slug: request.repo_slug.clone(),
                method: request.method.clone(),
                path: request.path.clone(),
                query: request.query.clone(),
                basic_credentials: request.basic_credentials.clone(),
            })
            .await?;

        self.handle_authorized(request, authorized).await
    }

    pub async fn authorize(
        &self,
        request: SmartHttpAuthorizationContext,
    ) -> Result<AuthorizedSmartHttpRequest, SmartHttpError> {
        let parsed = parse_smart_http_request(&request.method, &request.path, &request.query)?;
        if parsed.action.is_write() && request.basic_credentials.is_none() {
            return Err(SmartHttpError::MissingCredentials);
        }

        let metadata = self
            .authorizer
            .authorize(SmartHttpAuthorizationRequest {
                username: request.username,
                repo_slug: request.repo_slug,
                action: parsed.action,
                basic_credentials: request.basic_credentials,
            })
            .await?;

        Ok(AuthorizedSmartHttpRequest { parsed, metadata })
    }

    pub async fn handle_authorized(
        &self,
        request: SmartHttpRequest,
        authorized: AuthorizedSmartHttpRequest,
    ) -> Result<SmartHttpResponse, SmartHttpError> {
        let repository_path = self
            .storage
            .existing_bare_repository_path(
                &authorized.metadata.repository_id,
                &authorized.metadata.storage_path,
            )
            .await
            .map_err(storage_error_to_smart_http_error)?;

        self.backend
            .execute(GitHttpBackendRequest {
                repository_path,
                method: request.method,
                path: authorized.parsed.cgi_path,
                query: request.query,
                content_type: request
                    .headers
                    .get(http::header::CONTENT_TYPE)
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string),
                content_length: request.content_length,
                body: request.body,
                remote_user: authorized.metadata.authenticated_username,
            })
            .await
    }
}

#[derive(Clone, Debug)]
pub struct SmartHttpAuthorizationContext {
    pub username: String,
    pub repo_slug: String,
    pub method: Method,
    pub path: String,
    pub query: Option<String>,
    pub basic_credentials: Option<BasicCredentials>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct AuthorizedSmartHttpRequest {
    parsed: ParsedSmartHttpRequest,
    metadata: SmartHttpRepositoryMetadata,
}

#[derive(Debug)]
pub struct SmartHttpRequest {
    pub username: String,
    pub repo_slug: String,
    pub method: Method,
    pub path: String,
    pub query: Option<String>,
    pub headers: HeaderMap,
    pub content_length: Option<u64>,
    pub body: Body,
    pub basic_credentials: Option<BasicCredentials>,
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

        let service = query_service(query.as_deref())?.ok_or(SmartHttpError::UnsupportedService)?;

        return match service {
            "git-upload-pack" => Ok(ParsedSmartHttpRequest {
                action: SmartHttpAction::UploadPackInfoRefs,
                cgi_path: "/info/refs".to_string(),
            }),
            "git-receive-pack" => Ok(ParsedSmartHttpRequest {
                action: SmartHttpAction::ReceivePackInfoRefs,
                cgi_path: "/info/refs".to_string(),
            }),
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
        if method != Method::POST {
            return Err(SmartHttpError::UnsupportedMethod);
        }

        return Ok(ParsedSmartHttpRequest {
            action: SmartHttpAction::ReceivePack,
            cgi_path: "/git-receive-pack".to_string(),
        });
    }

    Err(SmartHttpError::InvalidPath)
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

        assert_eq!(parsed.action, SmartHttpAction::UploadPackInfoRefs);
        assert_eq!(parsed.cgi_path, "/info/refs");
    }

    #[test]
    fn parses_upload_pack_post() {
        let parsed = parse_smart_http_request(&Method::POST, "git-upload-pack", &None).unwrap();

        assert_eq!(parsed.action, SmartHttpAction::UploadPack);
        assert_eq!(parsed.cgi_path, "/git-upload-pack");
    }

    #[test]
    fn parses_receive_pack_info_refs() {
        let parsed = parse_smart_http_request(
            &Method::GET,
            "info/refs",
            &Some("service=git-receive-pack".to_string()),
        )
        .unwrap();

        assert_eq!(parsed.action, SmartHttpAction::ReceivePackInfoRefs);
        assert_eq!(parsed.cgi_path, "/info/refs");
    }

    #[test]
    fn parses_receive_pack_post() {
        let parsed = parse_smart_http_request(&Method::POST, "git-receive-pack", &None).unwrap();

        assert_eq!(parsed.action, SmartHttpAction::ReceivePack);
        assert_eq!(parsed.cgi_path, "/git-receive-pack");
    }

    #[test]
    fn rejects_duplicate_info_refs_service_values() {
        let error = parse_smart_http_request(
            &Method::GET,
            "info/refs",
            &Some("service=git-upload-pack&service=git-receive-pack".to_string()),
        )
        .unwrap_err();

        assert_eq!(error, SmartHttpError::UnsupportedService);
    }
}
