use std::time::Duration;

use tonic::Code;
use tonic::metadata::MetadataValue;
use tonic::transport::{Channel, Endpoint};

use crate::proto::NotifyPushRequest;
use crate::proto::git_push_events_service_client::GitPushEventsServiceClient;
use crate::push_events::domain::PushEventError;

const NOTIFICATION_TIMEOUT: Duration = Duration::from_secs(5);

/// Delivers observed pushes to the API over the connection the transports
/// already authorize against.
#[derive(Clone, Debug)]
pub struct ApiPushEventNotifier {
    channel: Option<Channel>,
    token: Option<String>,
}

impl ApiPushEventNotifier {
    pub fn new(endpoint_url: &str, token: Option<&str>) -> Self {
        let channel = build_channel(endpoint_url);

        if channel.is_none() {
            tracing::error!("push notifications unavailable: GIT_API_GRPC_URL is empty or invalid");
        }

        Self {
            channel,
            token: token.map(str::to_string),
        }
    }

    pub async fn notify(&self, request: &NotifyPushRequest) -> Result<(), PushEventError> {
        let channel = self
            .channel
            .clone()
            .ok_or(PushEventError::NotificationUnavailable)?;
        let mut client = GitPushEventsServiceClient::new(channel);

        client
            .notify_push(self.authorized_request(request.clone())?)
            .await
            .map_err(status_to_push_event_error)?;

        Ok(())
    }

    fn authorized_request(
        &self,
        request: NotifyPushRequest,
    ) -> Result<tonic::Request<NotifyPushRequest>, PushEventError> {
        let mut authorized = tonic::Request::new(request);

        if let Some(token) = self
            .token
            .as_deref()
            .filter(|token| !token.trim().is_empty())
        {
            let value = MetadataValue::try_from(format!("Bearer {token}"))
                .map_err(|_| PushEventError::NotificationUnavailable)?;
            authorized.metadata_mut().insert("authorization", value);
        }

        Ok(authorized)
    }
}

fn build_channel(endpoint_url: &str) -> Option<Channel> {
    if endpoint_url.trim().is_empty() {
        return None;
    }

    Endpoint::from_shared(endpoint_url.to_string())
        .map(|endpoint| {
            endpoint
                .connect_timeout(NOTIFICATION_TIMEOUT)
                .timeout(NOTIFICATION_TIMEOUT)
        })
        .inspect_err(
            |error| tracing::error!(error = %error, "push notification gRPC endpoint was invalid"),
        )
        .ok()
        .map(|endpoint| endpoint.connect_lazy())
}

/// Only a refusal of the payload itself is permanent. Everything else — an
/// unreachable API, a deadline, an internal failure — leaves the push spooled
/// for the next sweep.
fn status_to_push_event_error(status: tonic::Status) -> PushEventError {
    match status.code() {
        Code::InvalidArgument => PushEventError::NotificationRejected,
        _ => PushEventError::NotificationUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn treats_only_invalid_argument_as_permanent() {
        assert!(matches!(
            status_to_push_event_error(tonic::Status::new(Code::InvalidArgument, "")),
            PushEventError::NotificationRejected
        ));
        assert!(matches!(
            status_to_push_event_error(tonic::Status::new(Code::Unavailable, "")),
            PushEventError::NotificationUnavailable
        ));
        assert!(matches!(
            status_to_push_event_error(tonic::Status::new(Code::DeadlineExceeded, "")),
            PushEventError::NotificationUnavailable
        ));
        assert!(matches!(
            status_to_push_event_error(tonic::Status::new(Code::Internal, "")),
            PushEventError::NotificationUnavailable
        ));
        assert!(matches!(
            status_to_push_event_error(tonic::Status::new(Code::Unauthenticated, "")),
            PushEventError::NotificationUnavailable
        ));
    }

    #[tokio::test]
    async fn builds_reusable_channel_from_valid_endpoint() {
        assert!(build_channel("http://localhost:50053").is_some());
        assert!(build_channel("not a uri with spaces").is_none());
    }
}
