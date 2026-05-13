use async_trait::async_trait;
use tonic::Code;
use tonic::metadata::MetadataValue;
use tonic::transport::{Channel, Endpoint};

use crate::proto::git_authorization_service_client::GitAuthorizationServiceClient;
use crate::proto::{AuthorizeReadRequest, AuthorizeWriteRequest};
use crate::smart_http::application::{SmartHttpAuthorizationRequest, SmartHttpAuthorizer};
use crate::smart_http::domain::{SmartHttpError, SmartHttpRepositoryMetadata};

#[derive(Clone, Debug)]
pub struct ApiSmartHttpAuthorizer {
    channel: Option<Channel>,
    token: Option<String>,
}

impl ApiSmartHttpAuthorizer {
    pub fn new(endpoint_url: String, token: Option<String>) -> Self {
        let channel = build_channel(endpoint_url);

        if channel.is_none() {
            tracing::error!("authorization unavailable: GIT_API_GRPC_URL is empty or invalid");
        }

        Self { channel, token }
    }
}

#[async_trait]
impl SmartHttpAuthorizer for ApiSmartHttpAuthorizer {
    async fn authorize(
        &self,
        request: SmartHttpAuthorizationRequest,
    ) -> Result<SmartHttpRepositoryMetadata, SmartHttpError> {
        tracing::info!(
            username = %request.username,
            repo_slug = %request.repo_slug,
            service = %request.action.cgi_service_name(),
            action = %request.action.action_name(),
            "authorizing git smart HTTP request"
        );

        let mut client = GitAuthorizationServiceClient::new(
            self.channel
                .clone()
                .ok_or(SmartHttpError::AuthorizationUnavailable)?,
        );

        if request.action.is_write() {
            let basic_credentials = request
                .basic_credentials
                .ok_or(SmartHttpError::MissingCredentials)?;
            let grpc_request = AuthorizeWriteRequest {
                owner_username: request.username,
                repository_slug: request.repo_slug,
                service: request.action.cgi_service_name().to_string(),
                action: request.action.action_name().to_string(),
                basic_username: basic_credentials.username,
                token: basic_credentials.token,
            };

            return authorize_write(&mut client, grpc_request, self.token.as_deref()).await;
        }

        let grpc_request = AuthorizeReadRequest {
            owner_username: request.username,
            repository_slug: request.repo_slug,
            service: request.action.cgi_service_name().to_string(),
            action: request.action.action_name().to_string(),
        };

        authorize_read(&mut client, grpc_request, self.token.as_deref()).await
    }
}

fn build_channel(endpoint_url: String) -> Option<Channel> {
    if endpoint_url.trim().is_empty() {
        return None;
    }

    Endpoint::from_shared(endpoint_url)
        .inspect_err(
            |error| tracing::error!(error = %error, "authorization gRPC endpoint was invalid"),
        )
        .ok()
        .map(|endpoint| endpoint.connect_lazy())
}

async fn authorize_read(
    client: &mut GitAuthorizationServiceClient<Channel>,
    body: AuthorizeReadRequest,
    token: Option<&str>,
) -> Result<SmartHttpRepositoryMetadata, SmartHttpError> {
    let response = client
        .authorize_read(with_authorization_metadata(body, token)?)
        .await
        .map_err(status_to_smart_http_error)?
        .into_inner();

    Ok(SmartHttpRepositoryMetadata {
        repository_id: response.repository_id,
        storage_path: response.storage_path,
        authenticated_username: empty_string_to_none(response.trusted_user),
    })
}

async fn authorize_write(
    client: &mut GitAuthorizationServiceClient<Channel>,
    body: AuthorizeWriteRequest,
    token: Option<&str>,
) -> Result<SmartHttpRepositoryMetadata, SmartHttpError> {
    let response = client
        .authorize_write(with_authorization_metadata(body, token)?)
        .await
        .map_err(status_to_smart_http_error)?
        .into_inner();

    Ok(SmartHttpRepositoryMetadata {
        repository_id: response.repository_id,
        storage_path: response.storage_path,
        authenticated_username: empty_string_to_none(response.trusted_user),
    })
}

fn with_authorization_metadata<T>(
    body: T,
    token: Option<&str>,
) -> Result<tonic::Request<T>, SmartHttpError> {
    let mut request = tonic::Request::new(body);
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        let value = MetadataValue::try_from(format!("Bearer {token}"))
            .map_err(|_| SmartHttpError::AuthorizationUnavailable)?;
        request.metadata_mut().insert("authorization", value);
    }

    Ok(request)
}

fn status_to_smart_http_error(status: tonic::Status) -> SmartHttpError {
    match status.code() {
        Code::Unauthenticated => SmartHttpError::InvalidCredentials,
        Code::PermissionDenied | Code::NotFound => SmartHttpError::Unauthorized,
        Code::InvalidArgument | Code::FailedPrecondition => {
            SmartHttpError::InvalidRepositoryMetadata
        }
        _ => SmartHttpError::AuthorizationUnavailable,
    }
}

fn empty_string_to_none(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use tonic::Code;

    use crate::proto::{AuthorizeReadRequest, AuthorizeWriteRequest};
    use crate::smart_http::domain::SmartHttpError;

    use super::{build_channel, status_to_smart_http_error, with_authorization_metadata};

    #[test]
    fn constructs_write_request_with_credentials_and_metadata() {
        let request = with_authorization_metadata(
            AuthorizeWriteRequest {
                owner_username: "mona".to_string(),
                repository_slug: "repo".to_string(),
                service: "git-receive-pack".to_string(),
                action: "receive_pack".to_string(),
                basic_username: "mona".to_string(),
                token: "secret-token".to_string(),
            },
            Some("service-token"),
        )
        .unwrap();

        let body = request.get_ref();
        assert_eq!(body.owner_username, "mona");
        assert_eq!(body.repository_slug, "repo");
        assert_eq!(body.service, "git-receive-pack");
        assert_eq!(body.action, "receive_pack");
        assert_eq!(body.basic_username, "mona");
        assert_eq!(body.token, "secret-token");
        assert_eq!(
            request.metadata().get("authorization").unwrap(),
            "Bearer service-token"
        );
    }

    #[test]
    fn constructs_read_request_with_metadata() {
        let request = with_authorization_metadata(
            AuthorizeReadRequest {
                owner_username: "mona".to_string(),
                repository_slug: "repo".to_string(),
                service: "git-upload-pack".to_string(),
                action: "info_refs".to_string(),
            },
            Some("service-token"),
        )
        .unwrap();

        let body = request.get_ref();
        assert_eq!(body.owner_username, "mona");
        assert_eq!(body.repository_slug, "repo");
        assert_eq!(body.service, "git-upload-pack");
        assert_eq!(body.action, "info_refs");
        assert_eq!(
            request.metadata().get("authorization").unwrap(),
            "Bearer service-token"
        );
    }

    #[test]
    fn maps_grpc_status_codes() {
        assert_eq!(
            status_to_smart_http_error(tonic::Status::new(Code::Unauthenticated, "")),
            SmartHttpError::InvalidCredentials
        );
        assert_eq!(
            status_to_smart_http_error(tonic::Status::new(Code::PermissionDenied, "")),
            SmartHttpError::Unauthorized
        );
    }

    #[tokio::test]
    async fn builds_reusable_channel_from_valid_endpoint() {
        assert!(build_channel("http://localhost:50053".to_string()).is_some());
        assert!(build_channel("not a uri with spaces".to_string()).is_none());
    }
}
