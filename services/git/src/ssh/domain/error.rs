use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub enum SshGitError {
    InvalidCommand,
    UnsupportedService,
    InvalidRepositoryPath,
    AuthorizationUnavailable,
    Unauthorized,
    InvalidRepositoryMetadata,
    RepositoryUnavailable,
    BackendFailed,
}

impl fmt::Display for SshGitError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidCommand => write!(formatter, "invalid SSH Git command"),
            Self::UnsupportedService => write!(formatter, "unsupported SSH Git service"),
            Self::InvalidRepositoryPath => write!(formatter, "invalid SSH Git repository path"),
            Self::AuthorizationUnavailable => {
                write!(formatter, "authorization service unavailable")
            }
            Self::Unauthorized => write!(formatter, "repository access denied"),
            Self::InvalidRepositoryMetadata => write!(formatter, "repository metadata is invalid"),
            Self::RepositoryUnavailable => write!(formatter, "repository is unavailable"),
            Self::BackendFailed => write!(formatter, "git command failed"),
        }
    }
}

impl std::error::Error for SshGitError {}

pub fn ssh_exec_failure_message(error: &SshGitError) -> &'static str {
    match error {
        SshGitError::InvalidCommand => {
            "Invalid SSH Git command. Use git-upload-pack owner/repository.git or git-receive-pack owner/repository.git."
        }
        SshGitError::UnsupportedService => {
            "Unsupported SSH Git service. Only git-upload-pack and git-receive-pack are supported."
        }
        SshGitError::InvalidRepositoryPath => {
            "Invalid repository path. Use owner/repository.git without extra path segments."
        }
        SshGitError::AuthorizationUnavailable => {
            "Authorization service is unavailable. Try again later."
        }
        SshGitError::Unauthorized => {
            "Repository access denied. Confirm the repository exists and your SSH key has access."
        }
        SshGitError::InvalidRepositoryMetadata => {
            "Repository metadata is invalid. Contact support if this repository should be available."
        }
        SshGitError::RepositoryUnavailable => "Repository storage is unavailable. Try again later.",
        SshGitError::BackendFailed => "Git backend is unavailable. Try again later.",
    }
}
