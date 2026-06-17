use axum::body::Body;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, Method, Response, StatusCode, header};
use base64::Engine;

use crate::smart_http::application::{SmartHttpAuthorizationContext, SmartHttpRequest};
use crate::smart_http::domain::{BasicCredentials, SmartHttpError, query_service};
use crate::smart_http::http::SmartHttpService;
use crate::smart_http::http::response::{
    basic_auth_challenge_response, empty_response, smart_http_error_to_status,
};

const SMART_HTTP_BODY_LIMIT_BYTES: usize = 16 * 1024 * 1024;

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
    let is_receive_pack = match is_receive_pack_request(&path, query.as_deref()) {
        Ok(is_receive_pack) => is_receive_pack,
        Err(error) => {
            return smart_http_error_response(error, &method, &request_label, &query, false);
        }
    };
    let basic_credentials = match basic_credentials_for_request(is_receive_pack, &headers) {
        Ok(credentials) => credentials,
        Err(error) => return basic_auth_challenge_response(error),
    };
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
            Err(error) => {
                return smart_http_error_response(
                    error,
                    &method,
                    &request_label,
                    &query,
                    is_receive_pack,
                );
            }
        }
    } else {
        None
    };

    let (body, content_length) = if is_receive_pack {
        (body, content_length(&headers))
    } else {
        match axum::body::to_bytes(body, SMART_HTTP_BODY_LIMIT_BYTES).await {
            Ok(body) => {
                let content_length = body.len() as u64;
                (body.into(), Some(content_length))
            }
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
        }
    };

    let smart_http_request = SmartHttpRequest {
        username,
        repo_slug,
        method: method.clone(),
        path,
        query: query.clone(),
        headers,
        content_length,
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
        Err(error) => {
            smart_http_error_response(error, &method, &request_label, &query, is_receive_pack)
        }
    }
}

fn smart_http_error_response(
    error: SmartHttpError,
    method: &Method,
    request_label: &str,
    query: &Option<String>,
    is_receive_pack: bool,
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
        if matches!(error, SmartHttpError::Unauthorized) && !is_receive_pack {
            return empty_response(status);
        }

        basic_auth_challenge_response(error)
    } else if matches!(error, SmartHttpError::GitHubMirrorWriteDenied) && is_receive_pack {
        git_receive_pack_error_response(error, query)
    } else if matches!(error, SmartHttpError::GitHubMirrorWriteDenied) {
        plain_text_error_response(status, error)
    } else {
        empty_response(status)
    }
}

fn plain_text_error_response(status: StatusCode, error: SmartHttpError) -> Response<Body> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from(format!("{error}\n")))
        .expect("failed to build smart HTTP error response")
}

fn git_receive_pack_error_response(
    error: SmartHttpError,
    query: &Option<String>,
) -> Response<Body> {
    let is_advertisement = matches!(
        query_service(query.as_deref()).ok().flatten(),
        Some("git-receive-pack")
    );
    let (content_type, body) = if is_advertisement {
        (
            "application/x-git-receive-pack-advertisement",
            [
                pkt_line("# service=git-receive-pack\n"),
                "0000".as_bytes().to_vec(),
                pkt_line(&format!("ERR {error}\n")),
            ]
            .concat(),
        )
    } else {
        (
            "application/x-git-receive-pack-result",
            pkt_line(&format!("ERR {error}\n")),
        )
    };

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(body))
        .expect("failed to build smart HTTP error response")
}

fn pkt_line(value: &str) -> Vec<u8> {
    let length = value.len() + 4;

    format!("{length:04x}{value}").into_bytes()
}

fn parse_repo_git_segment(repo_git: &str) -> Option<String> {
    let repo_slug = repo_git.strip_suffix(".git")?;

    (!repo_slug.is_empty()).then(|| repo_slug.to_string())
}

fn is_receive_pack_request(path: &str, query: Option<&str>) -> Result<bool, SmartHttpError> {
    if path == "git-receive-pack" {
        return Ok(true);
    }

    if path != "info/refs" {
        return Ok(false);
    }

    Ok(query_service(query)? == Some("git-receive-pack"))
}

fn basic_credentials_for_request(
    is_receive_pack: bool,
    headers: &HeaderMap,
) -> Result<Option<BasicCredentials>, SmartHttpError> {
    if !is_receive_pack {
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

fn content_length(headers: &HeaderMap) -> Option<u64> {
    headers
        .get(http::header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
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
    use http_body_util::BodyExt;
    use tempfile::TempDir;

    use crate::smart_http::application::SmartHttpApplication;
    use crate::smart_http::infrastructure::{ApiSmartHttpAuthorizer, GitHttpBackend};
    use crate::storage::infrastructure::RepositoryStorage;

    use super::*;

    #[test]
    fn detects_receive_pack_info_refs_before_body_read() {
        assert!(is_receive_pack_request("info/refs", Some("service=git-receive-pack")).unwrap());
    }

    #[test]
    fn detects_receive_pack_post_before_body_read() {
        assert!(is_receive_pack_request("git-receive-pack", None).unwrap());
    }

    #[test]
    fn allows_upload_pack_requests() {
        assert!(!is_receive_pack_request("info/refs", Some("service=git-upload-pack")).unwrap());
        assert!(!is_receive_pack_request("git-upload-pack", None).unwrap());
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
        let error = basic_credentials_for_request(true, &HeaderMap::new()).unwrap_err();

        assert_eq!(error, SmartHttpError::MissingCredentials);
    }

    #[test]
    fn rejects_duplicate_info_refs_service_values() {
        let error = is_receive_pack_request(
            "info/refs",
            Some("service=git-upload-pack&service=git-receive-pack"),
        )
        .unwrap_err();

        assert_eq!(error, SmartHttpError::UnsupportedService);
    }

    #[test]
    fn parses_content_length_header() {
        let mut headers = HeaderMap::new();
        headers.insert(http::header::CONTENT_LENGTH, "42".parse().unwrap());

        assert_eq!(content_length(&headers), Some(42));
    }

    #[test]
    fn read_authorization_denials_do_not_challenge_for_basic_credentials() {
        let response = smart_http_error_response(
            SmartHttpError::Unauthorized,
            &Method::GET,
            "mona/repo.git/info/refs",
            &Some("service=git-upload-pack".to_string()),
            false,
        );

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(
            !response
                .headers()
                .contains_key(http::header::WWW_AUTHENTICATE)
        );
    }

    #[test]
    fn write_authorization_denials_challenge_for_basic_credentials() {
        let response = smart_http_error_response(
            SmartHttpError::Unauthorized,
            &Method::POST,
            "mona/repo.git/git-receive-pack",
            &None,
            true,
        );

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response
                .headers()
                .get(http::header::WWW_AUTHENTICATE)
                .unwrap(),
            "Basic realm=\"Tessera Git\""
        );
    }

    #[tokio::test]
    async fn github_mirror_write_denial_returns_client_facing_copy() {
        let response = smart_http_error_response(
            SmartHttpError::GitHubMirrorWriteDenied,
            &Method::GET,
            "mona/repo.git/info/refs",
            &Some("service=git-receive-pack".to_string()),
            true,
        );

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(http::header::CONTENT_TYPE).unwrap(),
            "application/x-git-receive-pack-advertisement"
        );
        assert!(
            !response
                .headers()
                .contains_key(http::header::WWW_AUTHENTICATE)
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();

        assert_eq!(
            String::from_utf8(body.to_vec()).unwrap(),
            "001f# service=git-receive-pack\n00000053ERR GitHub is the source of truth for this repository. Push to GitHub instead.\n"
        );
    }

    #[tokio::test]
    async fn github_mirror_write_denial_returns_receive_pack_result_for_post() {
        let response = smart_http_error_response(
            SmartHttpError::GitHubMirrorWriteDenied,
            &Method::POST,
            "mona/repo.git/git-receive-pack",
            &None,
            true,
        );

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(http::header::CONTENT_TYPE).unwrap(),
            "application/x-git-receive-pack-result"
        );
        let body = response.into_body().collect().await.unwrap().to_bytes();

        assert_eq!(
            String::from_utf8(body.to_vec()).unwrap(),
            "0053ERR GitHub is the source of truth for this repository. Push to GitHub instead.\n"
        );
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
