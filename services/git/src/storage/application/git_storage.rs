use crate::domain::{
    RepositoryBlobPreview, RepositoryBrowserSummary, RepositoryCommitList, RepositoryCreated,
    RepositoryError, RepositoryId, RepositoryImported, RepositoryRawBlob, RepositoryRefList,
    RepositoryTree, TrustedGpgKey,
};
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

    pub async fn import_repository(
        &self,
        repository_id: &str,
        storage_path: &str,
        source_url: &str,
        access_token: Option<&str>,
        default_branch_hint: &str,
    ) -> Result<RepositoryImported, RepositoryError> {
        let repository_id = RepositoryId::parse(repository_id)?;

        self.storage
            .import_repository(
                &repository_id,
                storage_path,
                source_url,
                access_token,
                default_branch_hint,
            )
            .await
    }

    pub async fn get_repository_browser_summary(
        &self,
        repository_id: &str,
        storage_path: &str,
        default_branch: &str,
        ref_name: &str,
    ) -> Result<RepositoryBrowserSummary, RepositoryError> {
        self.storage
            .get_repository_browser_summary(repository_id, storage_path, default_branch, ref_name)
            .await
    }

    pub async fn list_repository_refs(
        &self,
        repository_id: &str,
        storage_path: &str,
        trusted_gpg_keys: &[TrustedGpgKey],
    ) -> Result<RepositoryRefList, RepositoryError> {
        self.storage
            .list_repository_refs(repository_id, storage_path, trusted_gpg_keys)
            .await
    }

    pub async fn get_repository_tree(
        &self,
        repository_id: &str,
        storage_path: &str,
        ref_name: &str,
        path: &str,
    ) -> Result<RepositoryTree, RepositoryError> {
        self.storage
            .get_repository_tree(repository_id, storage_path, ref_name, path)
            .await
    }

    pub async fn get_repository_blob(
        &self,
        repository_id: &str,
        storage_path: &str,
        object_id: &str,
    ) -> Result<RepositoryBlobPreview, RepositoryError> {
        self.storage
            .get_repository_blob(repository_id, storage_path, object_id)
            .await
    }

    pub async fn get_repository_raw_blob(
        &self,
        repository_id: &str,
        storage_path: &str,
        object_id: &str,
    ) -> Result<RepositoryRawBlob, RepositoryError> {
        self.storage
            .get_repository_raw_blob(repository_id, storage_path, object_id)
            .await
    }

    pub async fn list_repository_commits(
        &self,
        repository_id: &str,
        storage_path: &str,
        ref_name: &str,
        limit: u32,
        trusted_gpg_keys: &[TrustedGpgKey],
    ) -> Result<RepositoryCommitList, RepositoryError> {
        self.storage
            .list_repository_commits(
                repository_id,
                storage_path,
                ref_name,
                limit,
                trusted_gpg_keys,
            )
            .await
    }
}
