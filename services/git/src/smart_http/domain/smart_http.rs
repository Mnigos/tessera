use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SmartHttpAction {
    InfoRefs,
    UploadPack,
}

impl SmartHttpAction {
    pub fn cgi_service_name(self) -> &'static str {
        match self {
            Self::InfoRefs | Self::UploadPack => "git-upload-pack",
        }
    }

    pub fn is_info_refs(self) -> bool {
        matches!(self, Self::InfoRefs)
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum SmartHttpError {
    InvalidPath,
    UnsupportedMethod,
    PushRejected,
    UnsupportedService,
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
            Self::PushRejected => write!(formatter, "git push is not supported"),
            Self::UnsupportedService => write!(formatter, "unsupported Git smart HTTP service"),
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
}
