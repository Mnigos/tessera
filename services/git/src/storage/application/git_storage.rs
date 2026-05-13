use crate::domain::{RepositoryBrowserSummary, RepositoryCreated, RepositoryError, RepositoryId};
use crate::storage::infrastructure::RepositoryStorage;

#[derive(Clone, Debug)]
pub struct GitStorageApplication {
    storage: RepositoryStorage,
}

impl GitStorageApplication {
    pub fn new(storage: RepositoryStorage) -> Self {
        Self { storage }
    }

    pub fn health(&self) -> &'static str {
        "SERVING"
    }

    pub async fn create_repository(
        &self,
        repository_id: &str,
    ) -> Result<RepositoryCreated, RepositoryError> {
        let repository_id = RepositoryId::parse(repository_id)?;

        self.storage.create_repository(&repository_id).await
    }

    pub async fn get_repository_browser_summary(
        &self,
        repository_id: &str,
        storage_path: &str,
        default_branch: &str,
    ) -> Result<RepositoryBrowserSummary, RepositoryError> {
        self.storage
            .get_repository_browser_summary(repository_id, storage_path, default_branch)
            .await
    }
}
