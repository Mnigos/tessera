use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::{Child, Command};

use crate::ssh::domain::{SshGitError, SshGitOperation};

#[derive(Clone, Debug)]
pub struct GitSshBackend {
    git_binary: PathBuf,
}

impl GitSshBackend {
    pub fn new(git_binary: PathBuf) -> Self {
        Self { git_binary }
    }

    pub async fn execute(&self, request: GitSshBackendRequest) -> Result<(), SshGitError> {
        let output = Command::new(&self.git_binary)
            .arg(request.operation.git_subcommand())
            .arg(request.repository_path)
            .env_clear()
            .output()
            .await
            .map_err(|_| SshGitError::BackendFailed)?;

        if !output.status.success() {
            return Err(SshGitError::BackendFailed);
        }

        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitSshBackendRequest {
    pub operation: SshGitOperation,
    pub repository_path: PathBuf,
}

pub fn spawn_git_ssh_process(
    git_binary: PathBuf,
    request: GitSshBackendRequest,
) -> Result<Child, SshGitError> {
    Command::new(git_binary)
        .arg(request.operation.git_subcommand())
        .arg(request.repository_path)
        .env_clear()
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
        };

        assert_eq!(request.operation.git_subcommand(), "receive-pack");
        assert_eq!(
            request.repository_path,
            PathBuf::from("/tmp/repositories/repo-id.git")
        );
    }
}
