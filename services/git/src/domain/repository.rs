use std::path::PathBuf;

#[derive(Debug, PartialEq, Eq)]
pub struct RepositoryCreated {
    pub path: PathBuf,
    pub storage_path: String,
    pub created: bool,
}
