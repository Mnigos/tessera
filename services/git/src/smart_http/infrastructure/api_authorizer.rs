use async_trait::async_trait;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

use crate::smart_http::application::{SmartHttpAuthorizationRequest, SmartHttpAuthorizer};
use crate::smart_http::domain::{SmartHttpError, SmartHttpRepositoryMetadata};

#[derive(Clone, Debug)]
pub struct ApiSmartHttpAuthorizer {
    client: reqwest::Client,
    endpoint_url: String,
    token: Option<String>,
}

impl ApiSmartHttpAuthorizer {
    pub fn new(endpoint_url: String, token: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            endpoint_url,
            token,
        }
    }
}

#[async_trait]
impl SmartHttpAuthorizer for ApiSmartHttpAuthorizer {
    async fn authorize(
        &self,
        request: SmartHttpAuthorizationRequest,
    ) -> Result<SmartHttpRepositoryMetadata, SmartHttpError> {
        if self.endpoint_url.is_empty() {
            eprintln!(
                "[tessera-git] authorization unavailable: GIT_API_AUTHORIZATION_URL is empty"
            );
            return Err(SmartHttpError::AuthorizationUnavailable);
        }

        let username = request.username;
        let repo_slug = request.repo_slug;
        let service = request.action.cgi_service_name().to_string();
        let operation = if request.action.is_info_refs() {
            "info_refs".to_string()
        } else {
            "upload_pack".to_string()
        };
        eprintln!(
            "[tessera-git] authorizing git read username={username} repo_slug={repo_slug} operation={operation} endpoint={}",
            self.endpoint_url
        );

        let mut builder = self.client.post(&self.endpoint_url).json(&AuthorizeBody {
            username,
            slug: repo_slug,
            service,
            operation,
        });

        if let Some(token) = &self.token {
            builder = builder.bearer_auth(token);
        }

        let response = builder.send().await.map_err(|error| {
            eprintln!(
                "[tessera-git] authorization request failed endpoint={} error={error}",
                self.endpoint_url
            );
            SmartHttpError::AuthorizationUnavailable
        })?;

        let status = response.status();

        if status.is_success() {
            let body = response
                .json::<AuthorizeResponse>()
                .await
                .map_err(|error| {
                    eprintln!(
                        "[tessera-git] authorization response JSON was invalid endpoint={} error={error}",
                        self.endpoint_url
                    );
                    SmartHttpError::InvalidRepositoryMetadata
                })?;

            Ok(SmartHttpRepositoryMetadata {
                repository_id: body.repository_id,
                storage_path: body.storage_path,
            })
        } else if matches!(
            status,
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
        ) {
            eprintln!(
                "[tessera-git] authorization denied endpoint={} status={}",
                self.endpoint_url, status
            );
            Err(SmartHttpError::Unauthorized)
        } else {
            eprintln!(
                "[tessera-git] authorization service returned unexpected status endpoint={} status={status}",
                self.endpoint_url
            );
            Err(SmartHttpError::AuthorizationUnavailable)
        }
    }
}

#[derive(Serialize)]
struct AuthorizeBody {
    username: String,
    slug: String,
    service: String,
    operation: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthorizeResponse {
    repository_id: String,
    storage_path: String,
}
