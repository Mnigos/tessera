use tokio::time::{Duration, interval};

use crate::push_events::domain::PushEventError;
use crate::push_events::infrastructure::{ApiPushEventNotifier, PushEventSpool};

pub const PUSH_EVENT_SWEEP_INTERVAL: Duration = Duration::from_secs(30);

/// Redelivers pushes the hook could not hand over, including any it was killed
/// before handing over at all. The hook writes before it notifies, so anything
/// still spooled is a push the API has not seen; the API's idempotency key is
/// what makes redelivering a push it already recorded harmless.
pub async fn run_push_event_sweeper(spool: PushEventSpool, notifier: ApiPushEventNotifier) {
    let mut schedule = interval(PUSH_EVENT_SWEEP_INTERVAL);

    loop {
        schedule.tick().await;
        sweep_push_events(&spool, &notifier).await;
    }
}

pub async fn sweep_push_events(spool: &PushEventSpool, notifier: &ApiPushEventNotifier) {
    spool.recover_pending().await;

    let pending = match spool.pending().await {
        Ok(pending) => pending,
        Err(error) => {
            tracing::warn!(error = %error, "spooled pushes could not be listed");
            return;
        }
    };

    for path in pending {
        let Ok(request) = spool.load(&path).await else {
            spool.set_aside(&path).await;
            continue;
        };

        match notifier.notify(&request).await {
            Ok(()) => spool.remove(&path).await,
            Err(PushEventError::NotificationRejected) => spool.set_aside(&path).await,
            // The API is unreachable rather than unhappy with this particular
            // push, so the rest of the sweep would only repeat the failure.
            Err(error) => {
                tracing::warn!(error = %error, "push sweep stopped: API is unavailable");
                return;
            }
        }
    }
}
