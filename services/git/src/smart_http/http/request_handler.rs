use axum::body;
use axum::body::Body;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, Method, Response, StatusCode};
use base64::Engine;

use crate::smart_http::application::{SmartHttpAuthorizationContext, SmartHttpRequest};
use crate::smart_http::domain::{BasicCredentials, SmartHttpError};
use crate::smart_http::http::SmartHttpService;
use crate::smart_http::http::response::{
    basic_auth_challenge_response, empty_response, smart_http_error_to_status,
};

const SMART_HTTP_BODY_LIMIT_BYTES: usize = 16 * 1024 * 1024;
const SMART_HTTP_RECEIVE_PACK_BODY_LIMIT_BYTES: usize = 512 * 1024 * 1024;

pub async fn handle_smart_http_root(
    State(service): State<SmartHttpService>,
    Path((username, repo_git)): Path<(String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> Response<Body> {
    let Some(repo_slug) = parse_repo_git_segment(&repo_git) else {
        return empty_response(StatusCode::NOT_FOUND);
    };

    handle(
        service,
        username,
        repo_slug,
        String::new(),
        query,
        method,
        headers,
        body,
    )
    .await
}

pub async fn handle_smart_http(
    State(service): State<SmartHttpService>,
    Path((username, repo_git, path)): Path<(String, String, String)>,
    RawQuery(query): RawQuery,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> Response<Body> {
    let Some(repo_slug) = parse_repo_git_segment(&repo_git) else {
        return empty_response(StatusCode::NOT_FOUND);
    };

    handle(
        service, username, repo_slug, path, query, method, headers, body,
    )
    .await
}

async fn handle(
    service: SmartHttpService,
    username: String,
    repo_slug: String,
    path: String,
    query: Option<String>,
    method: Method,
    headers: HeaderMap,
    body: Body,
) -> Response<Body> {
    let request_label = format!("{username}/{repo_slug}.git/{path}");
    let basic_credentials = match basic_credentials_for_request(&path, query.as_deref(), &headers) {
        Ok(credentials) => credentials,
        Err(error) => return basic_auth_challenge_response(error),
    };
    let is_receive_pack = is_receive_pack_request(&path, query.as_deref());
    let authorized = if is_receive_pack {
        match service
            .authorize(SmartHttpAuthorizationContext {
                username: username.clone(),
                repo_slug: repo_slug.clone(),
                method: method.clone(),
                path: path.clone(),
                query: query.clone(),
                basic_credentials: basic_credentials.clone(),
            })
            .await
        {
            Ok(authorized) => Some(authorized),
            Err(error) => return smart_http_error_response(error, &method, &request_label, &query),
        }
    } else {
        None
    };

    let body_limit = if is_receive_pack {
        SMART_HTTP_RECEIVE_PACK_BODY_LIMIT_BYTES
    } else {
        SMART_HTTP_BODY_LIMIT_BYTES
    };
    let body = match body::to_bytes(body, body_limit).await {
        Ok(body) => body,
        Err(error) => {
            tracing::warn!(
                method = %method,
                path = %request_label,
                query = ?query,
                error = %error,
                "smart_http rejected oversized or invalid body"
            );
            return empty_response(StatusCode::PAYLOAD_TOO_LARGE);
        }
    };

    let smart_http_request = SmartHttpRequest {
        username,
        repo_slug,
        method: method.clone(),
        path,
        query: query.clone(),
        headers,
        body,
        basic_credentials,
    };
    let result = match authorized {
        Some(authorized) => {
            service
                .handle_authorized(smart_http_request, authorized)
                .await
        }
        None => service.handle(smart_http_request).await,
    };

    match result {
        Ok(response) => {
            let mut builder = Response::builder().status(response.status);
            for (name, value) in response.headers {
                builder = builder.header(name, value);
            }
            builder
                .body(Body::from(response.body))
                .unwrap_or_else(|_| empty_response(StatusCode::INTERNAL_SERVER_ERROR))
        }
        Err(error) => smart_http_error_response(error, &method, &request_label, &query),
    }
}

fn smart_http_error_response(
    error: SmartHttpError,
    method: &Method,
    request_label: &str,
    query: &Option<String>,
) -> Response<Body> {
    let status = smart_http_error_to_status(&error);
    tracing::warn!(
        method = %method,
        path = %request_label,
        query = ?query,
        status = status.as_u16(),
        error = %error,
        "smart_http failed"
    );
    if matches!(
        error,
        SmartHttpError::MissingCredentials
            | SmartHttpError::InvalidCredentials
            | SmartHttpError::Unauthorized
    ) {
        basic_auth_challenge_response(error)
    } else {
        empty_response(status)
    }
}

fn parse_repo_git_segment(repo_git: &str) -> Option<String> {
    let repo_slug = repo_git.strip_suffix(".git")?;

    (!repo_slug.is_empty()).then(|| repo_slug.to_string())
}

fn is_receive_pack_request(path: &str, query: Option<&str>) -> bool {
    path == "git-receive-pack"
        || (path == "info/refs"
            && query.is_some_and(|query| {
                query
                    .split('&')
                    .any(|part| part == "service=git-receive-pack")
            }))
}

fn basic_credentials_for_request(
    path: &str,
    query: Option<&str>,
    headers: &HeaderMap,
) -> Result<Option<BasicCredentials>, SmartHttpError> {
    if !is_receive_pack_request(path, query) {
        return Ok(None);
    }

    let Some(header) = headers.get(http::header::AUTHORIZATION) else {
        return Err(SmartHttpError::MissingCredentials);
    };

    let header = header
        .to_str()
        .map_err(|_| SmartHttpError::InvalidCredentials)?;

    parse_basic_authorization_header(header).map(Some)
}

fn parse_basic_authorization_header(header: &str) -> Result<BasicCredentials, SmartHttpError> {
    let encoded = header
        .strip_prefix("Basic ")
        .ok_or(SmartHttpError::InvalidCredentials)?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| SmartHttpError::InvalidCredentials)?;
    let decoded = String::from_utf8(decoded).map_err(|_| SmartHttpError::InvalidCredentials)?;
    let (username, token) = decoded
        .split_once(':')
        .ok_or(SmartHttpError::InvalidCredentials)?;

    if username.is_empty() || token.is_empty() {
        return Err(SmartHttpError::InvalidCredentials);
    }

    Ok(BasicCredentials {
        username: username.to_string(),
        token: token.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use axum::body::Body;
    use axum::http::{HeaderMap, Method, StatusCode};
    use tempfile::TempDir;

    use crate::smart_http::application::SmartHttpApplication;
    use crate::smart_http::infrastructure::{ApiSmartHttpAuthorizer, GitHttpBackend};
    use crate::storage::infrastructure::RepositoryStorage;

    use super::*;

    #[test]
    fn detects_receive_pack_info_refs_before_body_read() {
        assert!(is_receive_pack_request(
            "info/refs",
            Some("service=git-receive-pack")
        ));
    }

    #[test]
    fn detects_receive_pack_post_before_body_read() {
        assert!(is_receive_pack_request("git-receive-pack", None));
    }

    #[test]
    fn allows_upload_pack_requests() {
        assert!(!is_receive_pack_request(
            "info/refs",
            Some("service=git-upload-pack")
        ));
        assert!(!is_receive_pack_request("git-upload-pack", None));
    }

    #[test]
    fn parses_basic_authorization_header() {
        let credentials = parse_basic_authorization_header("Basic bW9uYTpnaHBfMTIz").unwrap();

        assert_eq!(credentials.username, "mona");
        assert_eq!(credentials.token, "ghp_123");
    }

    #[test]
    fn rejects_malformed_basic_authorization_header() {
        let error = parse_basic_authorization_header("Bearer token").unwrap_err();

        assert_eq!(error, SmartHttpError::InvalidCredentials);
    }

    #[test]
    fn receive_pack_requires_basic_credentials() {
        let error =
            basic_credentials_for_request("git-receive-pack", None, &HeaderMap::new()).unwrap_err();

        assert_eq!(error, SmartHttpError::MissingCredentials);
    }

    #[tokio::test]
    async fn rejects_oversized_upload_pack_body_before_authorization() {
        let temp_dir = TempDir::new().unwrap();
        let service = SmartHttpApplication::new(
            ApiSmartHttpAuthorizer::new(String::new(), None),
            RepositoryStorage::new(temp_dir.path().to_path_buf(), PathBuf::from("git")),
            GitHttpBackend::new(PathBuf::from("git")),
        );
        let body = Body::from(vec![0; SMART_HTTP_BODY_LIMIT_BYTES + 1]);

        let response = handle(
            service,
            "mona".to_string(),
            "repo".to_string(),
            "git-upload-pack".to_string(),
            None,
            Method::POST,
            HeaderMap::new(),
            body,
        )
        .await;

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn challenges_missing_receive_pack_credentials() {
        let temp_dir = TempDir::new().unwrap();
        let service = SmartHttpApplication::new(
            ApiSmartHttpAuthorizer::new(String::new(), None),
            RepositoryStorage::new(temp_dir.path().to_path_buf(), PathBuf::from("git")),
            GitHttpBackend::new(PathBuf::from("git")),
        );

        let response = handle(
            service,
            "mona".to_string(),
            "repo".to_string(),
            "git-receive-pack".to_string(),
            None,
            Method::POST,
            HeaderMap::new(),
            Body::from(vec![0; SMART_HTTP_BODY_LIMIT_BYTES + 1]),
        )
        .await;

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response
                .headers()
                .get(http::header::WWW_AUTHENTICATE)
                .unwrap(),
            "Basic realm=\"Tessera Git\""
        );
    }
}
