use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::{Child, Command};

use crate::domain::HIDDEN_REFS_CONFIG_ARGUMENT;
use crate::push_events::domain::{PushEventContext, PushHookConfig};
use crate::ssh::domain::{SshGitError, SshGitOperation};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitSshBackendRequest {
    pub operation: SshGitOperation,
    pub repository_path: PathBuf,
    /// Present only for receive-pack, which is the only operation that can move
    /// a ref and therefore the only one whose hook has anything to report.
    pub push_context: Option<PushEventContext>,
}

pub fn spawn_git_ssh_process(
    git_binary: PathBuf,
    push_hook: Option<&PushHookConfig>,
    request: GitSshBackendRequest,
) -> Result<Child, SshGitError> {
    let mut command = Command::new(git_binary);
    let push_hook = push_hook.zip(request.push_context.as_ref());

    // Scoped to this command, so only client pushes reach the hook: imports,
    // merges, and mirror pushes never run receive-pack.
    if let Some((hook, _)) = push_hook {
        command.arg("-c").arg(hook.hooks_path_argument());
    }

    command
        .arg("-c")
        .arg(HIDDEN_REFS_CONFIG_ARGUMENT)
        .arg(request.operation.git_subcommand())
        .arg(&request.repository_path)
        .env_clear()
        .envs(
            push_hook
                .map(|(hook, context)| hook.environment(context))
                .unwrap_or_default(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| SshGitError::BackendFailed)
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn maps_operations_to_git_subcommands() {
        assert_eq!(SshGitOperation::UploadPack.git_subcommand(), "upload-pack");
        assert_eq!(
            SshGitOperation::ReceivePack.git_subcommand(),
            "receive-pack"
        );
    }

    #[test]
    fn builds_backend_request_with_validated_repository_path() {
        let request = GitSshBackendRequest {
            operation: SshGitOperation::ReceivePack,
            repository_path: PathBuf::from("/tmp/repositories/repo-id.git"),
            push_context: None,
        };

        assert_eq!(request.operation.git_subcommand(), "receive-pack");
        assert_eq!(
            request.repository_path,
            PathBuf::from("/tmp/repositories/repo-id.git")
        );
    }
}
