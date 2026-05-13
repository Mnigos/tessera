use std::path::Path;

use tokio::fs;

use crate::domain::RepositoryError;

pub async fn reject_symlink(path: &Path) -> Result<(), RepositoryError> {
    if fs::symlink_metadata(path)
        .await
        .map_err(RepositoryError::StorageIo)?
        .file_type()
        .is_symlink()
    {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    Ok(())
}
