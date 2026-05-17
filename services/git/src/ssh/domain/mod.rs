pub mod command;

use std::fmt;

pub use command::parse_ssh_git_command;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SshGitOperation {
    UploadPack,
    ReceivePack,
}

impl SshGitOperation {
    pub fn git_service(self) -> &'static str {
        match self {
            Self::UploadPack => "git-upload-pack",
            Self::ReceivePack => "git-receive-pack",
        }
    }

    pub fn git_subcommand(self) -> &'static str {
        match self {
            Self::UploadPack => "upload-pack",
            Self::ReceivePack => "receive-pack",
        }
    }

    pub fn action_name(self) -> &'static str {
        match self {
            Self::UploadPack => "upload_pack",
            Self::ReceivePack => "receive_pack",
        }
    }

    pub fn is_write(self) -> bool {
        matches!(self, Self::ReceivePack)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshGitCommand {
    pub owner: String,
    pub repository: String,
    pub operation: SshGitOperation,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SshRepositoryMetadata {
    pub repository_id: String,
    pub storage_path: String,
}

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
