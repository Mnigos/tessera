#[derive(Debug)]
pub enum RepositoryError {
    InvalidRepositoryId,
    PathEscapesStorageRoot,
    ExistingPathNotBare,
    StorageIo(std::io::Error),
    GitProcessIo(std::io::Error),
    GitProcessFailed,
}
