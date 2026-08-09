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
    /// The Tessera user the authorized key belongs to. Never the SSH login,
    /// which is the literal `git` every client connects as.
    pub actor_user_id: Option<String>,
    pub storage_path: String,
}
