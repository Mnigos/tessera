use std::fmt;

#[derive(Debug)]
pub enum RepositoryError {
    InvalidRepositoryId,
    PathEscapesStorageRoot,
    ExistingPathNotBare,
    StorageIo(std::io::Error),
    GitProcessIo(std::io::Error),
    GitProcessFailed,
}

impl fmt::Display for RepositoryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidRepositoryId => write!(formatter, "repository id must be a valid UUID"),
            Self::PathEscapesStorageRoot => {
                write!(formatter, "repository path escapes storage root")
            }
            Self::ExistingPathNotBare => {
                write!(formatter, "repository path exists but is not bare")
            }
            Self::StorageIo(error) => write!(formatter, "storage I/O failed: {error}"),
            Self::GitProcessIo(error) => write!(formatter, "git process I/O failed: {error}"),
            Self::GitProcessFailed => write!(formatter, "git process failed"),
        }
    }
}

impl std::error::Error for RepositoryError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::StorageIo(error) | Self::GitProcessIo(error) => Some(error),
            _ => None,
        }
    }
}

impl From<std::io::Error> for RepositoryError {
    fn from(error: std::io::Error) -> Self {
        Self::StorageIo(error)
    }
}
