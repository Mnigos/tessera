use async_trait::async_trait;
use tonic::Code;
use tonic::metadata::MetadataValue;
use tonic::transport::{Channel, Endpoint};

use crate::proto::git_authorization_service_client::GitAuthorizationServiceClient;
use crate::proto::{AuthenticateSshKeyRequest, AuthorizeSshReadRequest, AuthorizeSshWriteRequest};
use crate::ssh::application::{
    SshAuthenticatedKey, SshGitAuthenticationRequest, SshGitAuthorizationRequest, SshGitAuthorizer,
};
use crate::ssh::domain::{SshGitError, SshRepositoryMetadata};

#[derive(Clone, Debug)]
pub struct ApiSshGitAuthorizer {
    channel: Option<Channel>,
    token: Option<String>,
}

impl ApiSshGitAuthorizer {
    pub fn new(endpoint_url: String, token: Option<String>) -> Self {
        let channel = build_channel(endpoint_url);

        if channel.is_none() {
            tracing::error!("SSH authorization unavailable: GIT_API_GRPC_URL is empty or invalid");
        }

        Self { channel, token }
    }
}

#[async_trait]
impl SshGitAuthorizer for ApiSshGitAuthorizer {
    async fn authenticate_public_key(
        &self,
        request: SshGitAuthenticationRequest,
    ) -> Result<SshAuthenticatedKey, SshGitError> {
        tracing::info!(
            username = %request.username,
            fingerprint = %request.public_key_fingerprint,
            "authenticating SSH public key"
        );

        let mut client = GitAuthorizationServiceClient::new(
            self.channel
                .clone()
                .ok_or(SshGitError::AuthorizationUnavailable)?,
        );
        let response = client
            .authenticate_ssh_key(with_authorization_metadata(
                AuthenticateSshKeyRequest {
                    username: request.username,
                    fingerprint_sha256: request.public_key_fingerprint,
                },
                self.token.as_deref(),
            )?)
            .await
            .map_err(status_to_ssh_error)?
            .into_inner();

        Ok(SshAuthenticatedKey {
            trusted_user: response.trusted_user,
        })
    }

    async fn authorize(
        &self,
        request: SshGitAuthorizationRequest,
    ) -> Result<SshRepositoryMetadata, SshGitError> {
        tracing::info!(
            username = %request.username,
            fingerprint = %request.public_key_fingerprint,
            owner = %request.owner,
            repository = %request.repository,
            service = %request.operation.git_service(),
            action = %request.operation.action_name(),
            "authorizing SSH Git request"
        );

        let mut client = GitAuthorizationServiceClient::new(
            self.channel
                .clone()
                .ok_or(SshGitError::AuthorizationUnavailable)?,
        );

        if request.operation.is_write() {
            let body = AuthorizeSshWriteRequest {
                owner_username: request.owner,
                repository_slug: request.repository,
                service: request.operation.git_service().to_string(),
                action: request.operation.action_name().to_string(),
                fingerprint_sha256: request.public_key_fingerprint,
            };

            return authorize_ssh_write(&mut client, body, self.token.as_deref()).await;
        }

        let body = AuthorizeSshReadRequest {
            owner_username: request.owner,
            repository_slug: request.repository,
            service: request.operation.git_service().to_string(),
            action: request.operation.action_name().to_string(),
            fingerprint_sha256: request.public_key_fingerprint,
        };

        authorize_ssh_read(&mut client, body, self.token.as_deref()).await
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

async fn authorize_ssh_read(
    client: &mut GitAuthorizationServiceClient<Channel>,
    body: AuthorizeSshReadRequest,
    token: Option<&str>,
) -> Result<SshRepositoryMetadata, SshGitError> {
    let response = client
        .authorize_ssh_read(with_authorization_metadata(body, token)?)
        .await
        .map_err(status_to_ssh_error)?
        .into_inner();

    Ok(SshRepositoryMetadata {
        repository_id: response.repository_id,
        storage_path: response.storage_path,
    })
}

async fn authorize_ssh_write(
    client: &mut GitAuthorizationServiceClient<Channel>,
    body: AuthorizeSshWriteRequest,
    token: Option<&str>,
) -> Result<SshRepositoryMetadata, SshGitError> {
    let response = client
        .authorize_ssh_write(with_authorization_metadata(body, token)?)
        .await
        .map_err(status_to_ssh_error)?
        .into_inner();

    Ok(SshRepositoryMetadata {
        repository_id: response.repository_id,
        storage_path: response.storage_path,
    })
}

fn with_authorization_metadata<T>(
    body: T,
    token: Option<&str>,
) -> Result<tonic::Request<T>, SshGitError> {
    let mut request = tonic::Request::new(body);
    if let Some(token) = token.filter(|token| !token.trim().is_empty()) {
        let value = MetadataValue::try_from(format!("Bearer {token}"))
            .map_err(|_| SshGitError::AuthorizationUnavailable)?;
        request.metadata_mut().insert("authorization", value);
    }

    Ok(request)
}

fn status_to_ssh_error(status: tonic::Status) -> SshGitError {
    match status.code() {
        Code::Unauthenticated => SshGitError::Unauthorized,
        Code::PermissionDenied | Code::NotFound => SshGitError::Unauthorized,
        Code::InvalidArgument | Code::FailedPrecondition => SshGitError::InvalidRepositoryMetadata,
        _ => SshGitError::AuthorizationUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use tonic::Code;

    use crate::proto::{AuthorizeSshReadRequest, AuthorizeSshWriteRequest};
    use crate::ssh::domain::SshGitError;

    use super::{build_channel, status_to_ssh_error, with_authorization_metadata};

    #[test]
    fn constructs_ssh_read_request_with_metadata() {
        let request = with_authorization_metadata(
            AuthorizeSshReadRequest {
                owner_username: "mona".to_string(),
                repository_slug: "repo".to_string(),
                service: "git-upload-pack".to_string(),
                action: "upload_pack".to_string(),
                fingerprint_sha256: "SHA256:abc".to_string(),
            },
            Some("service-token"),
        )
        .unwrap();

        let body = request.get_ref();
        assert_eq!(body.owner_username, "mona");
        assert_eq!(body.repository_slug, "repo");
        assert_eq!(body.fingerprint_sha256, "SHA256:abc");
        assert_eq!(
            request.metadata().get("authorization").unwrap(),
            "Bearer service-token"
        );
    }

    #[test]
    fn constructs_ssh_write_request_with_metadata() {
        let request = with_authorization_metadata(
            AuthorizeSshWriteRequest {
                owner_username: "mona".to_string(),
                repository_slug: "repo".to_string(),
                service: "git-receive-pack".to_string(),
                action: "receive_pack".to_string(),
                fingerprint_sha256: "SHA256:abc".to_string(),
            },
            Some("service-token"),
        )
        .unwrap();

        let body = request.get_ref();
        assert_eq!(body.service, "git-receive-pack");
        assert_eq!(body.action, "receive_pack");
        assert_eq!(body.fingerprint_sha256, "SHA256:abc");
        assert_eq!(
            request.metadata().get("authorization").unwrap(),
            "Bearer service-token"
        );
    }

    #[test]
    fn maps_grpc_status_codes() {
        assert_eq!(
            status_to_ssh_error(tonic::Status::new(Code::Unauthenticated, "")),
            SshGitError::Unauthorized
        );
        assert_eq!(
            status_to_ssh_error(tonic::Status::new(Code::FailedPrecondition, "")),
            SshGitError::InvalidRepositoryMetadata
        );
    }

    #[tokio::test]
    async fn builds_reusable_channel_from_valid_endpoint() {
        assert!(build_channel("http://localhost:50053".to_string()).is_some());
        assert!(build_channel("not a uri with spaces".to_string()).is_none());
    }
}
