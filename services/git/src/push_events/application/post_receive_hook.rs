use std::path::PathBuf;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use tokio::time::{Duration, timeout};

use crate::proto::{NotifyPushRequest, PushRefUpdate as PushRefUpdateMessage, PushRefUpdateKind};
use crate::push_events::domain::{
    PushEventError, PushHookEnvironment, PushRefUpdate, PushRefUpdateKind as PushRefUpdateVerdict,
    parse_post_receive_updates,
};
use crate::push_events::infrastructure::{
    ApiPushEventNotifier, PushEventSpool, RefUpdateClassifier,
};
use crate::storage::infrastructure::RepositoryStorage;

/// Everything the hook does has to finish well inside the 30 seconds the smart
/// HTTP backend allows the whole request, because the refs are already
/// committed: a hook that outlives that budget turns a successful push into a
/// failed one for the client.
const HOOK_BUDGET: Duration = Duration::from_secs(20);
/// Reserved out of the budget so spooling and notifying always get a turn, no
/// matter how many branches the push asked to classify.
const DELIVERY_RESERVE: Duration = Duration::from_secs(8);
const ANCESTRY_CHECK_BUDGET: Duration = Duration::from_secs(5);

/// The central `post-receive` hook. It runs once per push, after the refs have
/// already been committed, so nothing it does may fail the push: every failure
/// below is logged and swallowed, and the whole run is bounded.
pub async fn run_post_receive_hook(environment: &PushHookEnvironment, input: &str) {
    // The push happened when the hook started, not when classification ends.
    let occurred_at_unix_ms = occurred_at_unix_ms();
    let deadline = Instant::now() + HOOK_BUDGET;
    let updates = parse_post_receive_updates(input);

    if updates.is_empty() {
        return;
    }

    let repository_path = RepositoryStorage::new(
        environment.storage_root.clone(),
        environment.git_binary.clone(),
    )
    .repository_path(&environment.context.repository_id);
    let Ok(repository_path) = repository_path else {
        tracing::warn!(
            repository_id = %environment.context.repository_id,
            "push was not reported: repository is invalid"
        );
        return;
    };

    let classified = classify_updates(
        &RefUpdateClassifier::new(environment.git_binary.clone(), repository_path),
        updates,
        deadline - DELIVERY_RESERVE,
    )
    .await;

    if classified.is_empty() {
        return;
    }

    deliver(
        environment,
        NotifyPushRequest {
            operation_id: environment.context.operation_id.clone(),
            repository_id: environment.context.repository_id.clone(),
            actor_user_id: environment.context.actor_user_id.clone(),
            occurred_at_unix_ms,
            updates: classified,
        },
        deadline,
    )
    .await;
}

async fn classify_updates(
    classifier: &RefUpdateClassifier,
    updates: Vec<PushRefUpdate>,
    deadline: Instant,
) -> Vec<PushRefUpdateMessage> {
    let mut classified = Vec::with_capacity(updates.len());

    for update in updates {
        let Some(budget) = remaining(deadline) else {
            tracing::warn!("branch movements were dropped: classification budget elapsed");
            break;
        };

        match classifier
            .classify(
                &update.old_sha,
                &update.new_sha,
                budget.min(ANCESTRY_CHECK_BUDGET),
            )
            .await
        {
            Some(kind) => classified.push(to_message(update, kind)),
            // An unanswerable ancestry check is the one case where reporting
            // nothing beats reporting something: a dropped update is a missing
            // timeline entry, a guessed one accuses somebody of a rewrite.
            None => tracing::warn!(
                ref_name = %update.ref_name,
                "branch movement was dropped: ancestry could not be determined"
            ),
        }
    }

    classified
}

async fn deliver(environment: &PushHookEnvironment, request: NotifyPushRequest, deadline: Instant) {
    let spool = PushEventSpool::new(environment.spool_path());
    let spooled_path = store_within(&spool, &request, deadline).await;
    let notifier = ApiPushEventNotifier::new(
        &environment.api_grpc_url,
        environment.api_grpc_authorization_token.as_deref(),
    );
    let Some(budget) = remaining(deadline) else {
        tracing::warn!(
            operation_id = %request.operation_id,
            "push notification was left for a later sweep: hook budget elapsed"
        );
        return;
    };

    match timeout(budget, notifier.notify(&request)).await {
        Ok(Ok(())) => {
            if let Some(path) = spooled_path {
                spool.remove(&path).await;
            }
        }
        Ok(Err(PushEventError::NotificationRejected)) => match spooled_path {
            Some(path) => spool.set_aside(&path).await,
            None => tracing::warn!(
                operation_id = %request.operation_id,
                "API refused the push notification"
            ),
        },
        Ok(Err(error)) => tracing::warn!(
            error = %error,
            operation_id = %request.operation_id,
            "push notification was left for a later sweep"
        ),
        Err(_) => tracing::warn!(
            operation_id = %request.operation_id,
            "push notification was left for a later sweep: hook budget elapsed"
        ),
    }
}

async fn store_within(
    spool: &PushEventSpool,
    request: &NotifyPushRequest,
    deadline: Instant,
) -> Option<PathBuf> {
    let Some(budget) = remaining(deadline) else {
        tracing::error!("push could not be spooled: hook budget elapsed");
        return None;
    };

    match timeout(budget, spool.store(request)).await {
        Ok(Ok(path)) => Some(path),
        Ok(Err(error)) => {
            tracing::error!(error = %error, "push could not be spooled before notifying");
            None
        }
        Err(_) => {
            tracing::error!("push could not be spooled: hook budget elapsed");
            None
        }
    }
}

fn remaining(deadline: Instant) -> Option<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|budget| !budget.is_zero())
}

fn to_message(update: PushRefUpdate, kind: PushRefUpdateVerdict) -> PushRefUpdateMessage {
    PushRefUpdateMessage {
        ref_name: update.ref_name,
        old_sha: update.old_sha,
        new_sha: update.new_sha,
        kind: match kind {
            PushRefUpdateVerdict::HeadUpdated => PushRefUpdateKind::HeadUpdated as i32,
            PushRefUpdateVerdict::ForcePushed => PushRefUpdateKind::ForcePushed as i32,
        },
    }
}

fn occurred_at_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}
