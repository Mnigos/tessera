use axum::body;
use axum::body::Body;
use axum::extract::{Path, RawQuery, State};
use axum::http::{HeaderMap, Method, Response, StatusCode};

use crate::smart_http::application::SmartHttpRequest;
use crate::smart_http::http::SmartHttpService;
use crate::smart_http::http::response::{empty_response, smart_http_error_to_status};

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
    if is_receive_pack_request(&path, query.as_deref()) {
        eprintln!(
            "[tessera-git] smart_http rejected receive-pack request method={method} path={request_label} query={:?}",
            query
        );
        return empty_response(StatusCode::FORBIDDEN);
    }

    let body = match body::to_bytes(body, SMART_HTTP_BODY_LIMIT_BYTES).await {
        Ok(body) => body,
        Err(error) => {
            eprintln!(
                "[tessera-git] smart_http rejected oversized/invalid body method={method} path={request_label} query={:?} error={error}",
                query
            );
            return empty_response(StatusCode::PAYLOAD_TOO_LARGE);
        }
    };

    match service
        .handle(SmartHttpRequest {
            username,
            repo_slug,
            method: method.clone(),
            path,
            query: query.clone(),
            headers,
            body,
        })
        .await
    {
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
            let status = smart_http_error_to_status(&error);
            eprintln!(
                "[tessera-git] smart_http failed method={method} path={request_label} query={:?} status={} error={error}",
                query,
                status.as_u16()
            );
            empty_response(status)
        }
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
}
