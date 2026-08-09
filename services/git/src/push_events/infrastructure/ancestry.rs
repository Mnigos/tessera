use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::push_events::domain::PushRefUpdateKind;

/// Decides whether a branch moved forward or was rewritten, by asking Git
/// whether the commit the branch left behind is still an ancestor of the one it
/// now points at.
#[derive(Clone, Debug)]
pub struct RefUpdateClassifier {
    git_binary: PathBuf,
    repository_path: PathBuf,
}

impl RefUpdateClassifier {
    pub fn new(git_binary: PathBuf, repository_path: PathBuf) -> Self {
        Self {
            git_binary,
            repository_path,
        }
    }

    /// `None` when Git could not answer within the budget. A failure is never
    /// reported as a force-push: claiming somebody rewrote history is worse
    /// than saying nothing at all.
    pub async fn classify(
        &self,
        old_sha: &str,
        new_sha: &str,
        budget: Duration,
    ) -> Option<PushRefUpdateKind> {
        let status = timeout(
            budget,
            Command::new(&self.git_binary)
                .arg("--git-dir")
                .arg(&self.repository_path)
                .arg("merge-base")
                .arg("--is-ancestor")
                .arg(old_sha)
                .arg(new_sha)
                // receive-pack exports its own repository into the hook's
                // environment, so the inherited variables are dropped and only
                // the repository named on the command line is read.
                .env_clear()
                .env("PATH", std::env::var("PATH").unwrap_or_default())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                // A check that outran its budget must not outlive the hook that
                // gave up on it.
                .kill_on_drop(true)
                .status(),
        )
        .await;

        match status {
            Ok(Ok(status)) => match status.code() {
                Some(0) => Some(PushRefUpdateKind::HeadUpdated),
                Some(1) => Some(PushRefUpdateKind::ForcePushed),
                _ => None,
            },
            Ok(Err(error)) => {
                tracing::warn!(error = %error, "ancestry check could not be started");
                None
            }
            Err(_) => {
                tracing::warn!("ancestry check timed out");
                None
            }
        }
    }
}
