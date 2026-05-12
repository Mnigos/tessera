use std::env;
use std::path::{Component, Path, PathBuf};

use crate::domain::RepositoryId;

pub fn repository_path(storage_root: &Path, repository_id: &RepositoryId) -> PathBuf {
    repositories_root(storage_root).join(format!("{repository_id}.git"))
}

pub fn repositories_root(storage_root: &Path) -> PathBuf {
    storage_root.join("repositories")
}

pub fn normalize_root(storage_root: PathBuf) -> PathBuf {
    let absolute_root = if storage_root.is_absolute() {
        storage_root
    } else {
        env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(storage_root)
    };

    normalize_path(&absolute_root)
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    normalized.push(component.as_os_str());
                }
            }
            _ => normalized.push(component.as_os_str()),
        }
    }

    normalized
}
