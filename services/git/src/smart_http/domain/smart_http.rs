use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmartHttpAction {
    UploadPackInfoRefs,
    UploadPack,
    ReceivePackInfoRefs,
    ReceivePack,
}

impl SmartHttpAction {
    pub fn cgi_service_name(self) -> &'static str {
        match self {
            Self::UploadPackInfoRefs | Self::UploadPack => "git-upload-pack",
            Self::ReceivePackInfoRefs | Self::ReceivePack => "git-receive-pack",
        }
    }

    pub fn action_name(self) -> &'static str {
        match self {
            Self::UploadPackInfoRefs | Self::ReceivePackInfoRefs => "info_refs",
            Self::UploadPack => "upload_pack",
            Self::ReceivePack => "receive_pack",
        }
    }

    pub fn is_write(self) -> bool {
        matches!(self, Self::ReceivePackInfoRefs | Self::ReceivePack)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum SmartHttpError {
    InvalidPath,
    UnsupportedMethod,
    UnsupportedService,
    MissingCredentials,
    InvalidCredentials,
    AuthorizationUnavailable,
    Unauthorized,
    InvalidRepositoryMetadata,
    RepositoryUnavailable,
    BackendFailed,
    InvalidBackendResponse,
}

impl fmt::Display for SmartHttpError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPath => write!(formatter, "invalid smart HTTP path"),
            Self::UnsupportedMethod => write!(formatter, "unsupported smart HTTP method"),
            Self::UnsupportedService => write!(formatter, "unsupported Git smart HTTP service"),
            Self::MissingCredentials => write!(formatter, "git credentials are required"),
            Self::InvalidCredentials => write!(formatter, "git credentials are invalid"),
            Self::AuthorizationUnavailable => {
                write!(formatter, "authorization service unavailable")
            }
            Self::Unauthorized => write!(formatter, "repository access denied"),
            Self::InvalidRepositoryMetadata => write!(formatter, "repository metadata is invalid"),
            Self::RepositoryUnavailable => write!(formatter, "repository is unavailable"),
            Self::BackendFailed => write!(formatter, "git http-backend failed"),
            Self::InvalidBackendResponse => {
                write!(formatter, "git http-backend returned invalid CGI")
            }
        }
    }
}

impl std::error::Error for SmartHttpError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SmartHttpRepositoryMetadata {
    pub repository_id: String,
    pub storage_path: String,
    pub authenticated_username: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BasicCredentials {
    pub username: String,
    pub token: String,
}
