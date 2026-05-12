use crate::domain::{RepositoryCreated, RepositoryError, RepositoryId};
use crate::infrastructure::RepositoryStorage;

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
}
