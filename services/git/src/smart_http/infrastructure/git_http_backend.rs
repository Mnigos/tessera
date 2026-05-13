use std::path::PathBuf;

use axum::body::Body;
use bytes::Bytes;
use http_body_util::BodyExt;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::smart_http::application::SmartHttpResponse;
use crate::smart_http::domain::SmartHttpError;

#[derive(Clone, Debug)]
pub struct GitHttpBackend {
    git_binary: PathBuf,
}

impl GitHttpBackend {
    pub fn new(git_binary: PathBuf) -> Self {
        Self { git_binary }
    }

    pub async fn execute(
        &self,
        request: GitHttpBackendRequest,
    ) -> Result<SmartHttpResponse, SmartHttpError> {
        let project_root = request
            .repository_path
            .parent()
            .ok_or(SmartHttpError::RepositoryUnavailable)?;
        let repository_name = request
            .repository_path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or(SmartHttpError::RepositoryUnavailable)?;
        let path_info = format!("/{repository_name}{}", request.path);

        let mut command = Command::new(&self.git_binary);
        command
            .arg("http-backend")
            .env_clear()
            .env("GIT_PROJECT_ROOT", project_root)
            .env("GIT_HTTP_EXPORT_ALL", "")
            .env("REQUEST_METHOD", request.method.to_string())
            .env("PATH_INFO", path_info)
            .env("QUERY_STRING", request.query.unwrap_or_default())
            .env(
                "CONTENT_TYPE",
                request
                    .content_type
                    .unwrap_or_else(|| "application/x-git-upload-pack-request".to_string()),
            )
            .envs(
                request
                    .remote_user
                    .map(|remote_user| ("REMOTE_USER", remote_user)),
            )
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

        if let Some(content_length) = request.content_length {
            command.env("CONTENT_LENGTH", content_length.to_string());
        }

        let mut child = command.spawn().map_err(|_| SmartHttpError::BackendFailed)?;

        if let Some(mut stdin) = child.stdin.take() {
            let mut body = request.body;
            while let Some(frame) = body.frame().await {
                let frame = frame.map_err(|_| SmartHttpError::BackendFailed)?;
                if let Some(data) = frame.data_ref() {
                    stdin
                        .write_all(data)
                        .await
                        .map_err(|_| SmartHttpError::BackendFailed)?;
                }
            }
        }

        let output = timeout(Duration::from_secs(30), child.wait_with_output())
            .await
            .map_err(|_| SmartHttpError::BackendFailed)?
            .map_err(|_| SmartHttpError::BackendFailed)?;

        if !output.status.success() {
            return Err(SmartHttpError::BackendFailed);
        }

        parse_cgi_response(Bytes::from(output.stdout))
    }
}

#[derive(Debug)]
pub struct GitHttpBackendRequest {
    pub repository_path: PathBuf,
    pub method: http::Method,
    pub path: String,
    pub query: Option<String>,
    pub content_type: Option<String>,
    pub content_length: Option<u64>,
    pub body: Body,
    pub remote_user: Option<String>,
}

fn parse_cgi_response(output: Bytes) -> Result<SmartHttpResponse, SmartHttpError> {
    let separator = find_header_separator(&output).ok_or(SmartHttpError::InvalidBackendResponse)?;
    let header_bytes = &output[..separator.header_end];
    let body = output.slice(separator.body_start..);
    let header_text =
        std::str::from_utf8(header_bytes).map_err(|_| SmartHttpError::InvalidBackendResponse)?;
    let mut status = 200;
    let mut headers = Vec::new();

    for line in header_text.lines() {
        let Some((name, value)) = line.split_once(':') else {
            return Err(SmartHttpError::InvalidBackendResponse);
        };

        if name.eq_ignore_ascii_case("Status") {
            let status_code = value
                .trim()
                .split_once(' ')
                .map_or(value.trim(), |(code, _)| code)
                .parse::<u16>()
                .map_err(|_| SmartHttpError::InvalidBackendResponse)?;
            status = status_code;
            continue;
        }

        headers.push((name.to_string(), value.trim().to_string()));
    }

    Ok(SmartHttpResponse {
        status,
        headers,
        body,
    })
}

struct HeaderSeparator {
    header_end: usize,
    body_start: usize,
}

fn find_header_separator(output: &[u8]) -> Option<HeaderSeparator> {
    output
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| HeaderSeparator {
            header_end: index,
            body_start: index + 4,
        })
        .or_else(|| {
            output
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| HeaderSeparator {
                    header_end: index,
                    body_start: index + 2,
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cgi_headers_body_and_status() {
        let response = parse_cgi_response(Bytes::from_static(
            b"Status: 403 Forbidden\r\nContent-Type: text/plain\r\n\r\nnope",
        ))
        .unwrap();

        assert_eq!(response.status, 403);
        assert_eq!(
            response.headers,
            vec![("Content-Type".to_string(), "text/plain".to_string())]
        );
        assert_eq!(response.body, Bytes::from_static(b"nope"));
    }

    #[test]
    fn rejects_invalid_cgi_response() {
        let error =
            parse_cgi_response(Bytes::from_static(b"Content-Type: text/plain")).unwrap_err();

        assert_eq!(error, SmartHttpError::InvalidBackendResponse);
    }
}
