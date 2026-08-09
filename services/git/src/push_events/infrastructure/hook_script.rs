use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use tokio::fs;
use uuid::Uuid;

use crate::push_events::domain::{POST_RECEIVE_HOOK_COMMAND, PushEventError};

const HOOK_NAME: &str = "post-receive";
const HOOK_MODE: u32 = 0o755;

/// Writes the one hook every receive-pack execution is pointed at. Rewriting it
/// on every start is the repair: the script names the binary that installed it,
/// which a deployment moves.
pub async fn install_post_receive_hook(
    hooks_path: &Path,
    service_binary: &Path,
) -> Result<(), PushEventError> {
    fs::create_dir_all(hooks_path)
        .await
        .map_err(PushEventError::SpoolIo)?;

    // Named for this installer alone: replicas sharing a storage root install
    // concurrently, and one of them renaming a file the other is still writing
    // would leave that replica serving pushes with no hook at all.
    let pending_path = hooks_path.join(format!("{HOOK_NAME}.{}.pending", Uuid::new_v4()));
    let result = write_pending_hook(&pending_path, service_binary).await;

    if result.is_err() {
        let _ = fs::remove_file(&pending_path).await;

        return result;
    }

    fs::rename(&pending_path, hooks_path.join(HOOK_NAME))
        .await
        .map_err(PushEventError::SpoolIo)
}

async fn write_pending_hook(
    pending_path: &Path,
    service_binary: &Path,
) -> Result<(), PushEventError> {
    fs::write(pending_path, hook_script(service_binary))
        .await
        .map_err(PushEventError::SpoolIo)?;
    fs::set_permissions(pending_path, std::fs::Permissions::from_mode(HOOK_MODE))
        .await
        .map_err(PushEventError::SpoolIo)
}

fn hook_script(service_binary: &Path) -> String {
    format!(
        "#!/bin/sh\nexec '{}' {POST_RECEIVE_HOOK_COMMAND}\n",
        service_binary.display()
    )
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    #[tokio::test]
    async fn installs_an_executable_hook_that_runs_the_service_binary() {
        let temp_dir = TempDir::new().unwrap();
        let hooks_path = temp_dir.path().join("hooks");

        install_post_receive_hook(&hooks_path, Path::new("/opt/tessera/git"))
            .await
            .unwrap();

        let hook_path = hooks_path.join(HOOK_NAME);
        let script = fs::read_to_string(&hook_path).await.unwrap();
        let mode = fs::metadata(&hook_path).await.unwrap().permissions().mode();

        assert_eq!(
            script,
            "#!/bin/sh\nexec '/opt/tessera/git' post-receive-hook\n"
        );
        assert_eq!(mode & 0o777, HOOK_MODE);
    }

    #[tokio::test]
    async fn repairs_an_existing_hook_in_place() {
        let temp_dir = TempDir::new().unwrap();
        let hooks_path = temp_dir.path().join("hooks");
        install_post_receive_hook(&hooks_path, Path::new("/opt/tessera/old"))
            .await
            .unwrap();

        install_post_receive_hook(&hooks_path, Path::new("/opt/tessera/new"))
            .await
            .unwrap();

        let script = fs::read_to_string(hooks_path.join(HOOK_NAME))
            .await
            .unwrap();

        assert_eq!(
            script,
            "#!/bin/sh\nexec '/opt/tessera/new' post-receive-hook\n"
        );
    }
}
