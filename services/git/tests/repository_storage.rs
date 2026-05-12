use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;
use tessera_git::{RepositoryError, RepositoryId, RepositoryStorage};

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";

#[test]
fn path_construction_places_uuid_under_repositories_root() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");

    let path = storage.repository_path(REPOSITORY_ID).unwrap();

    assert_eq!(
        path,
        temp_dir
            .path()
            .join("repositories")
            .join(format!("{REPOSITORY_ID}.git"))
    );
}

#[test]
fn path_construction_rejects_invalid_ids_and_traversal() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");

    for repository_id in [
        "",
        "not-a-uuid",
        "../outside",
        &format!("{REPOSITORY_ID}/../x"),
    ] {
        let error = storage.repository_path(repository_id).unwrap_err();

        assert!(matches!(error, RepositoryError::InvalidRepositoryId));
    }
}

#[tokio::test]
async fn create_repository_is_idempotent_for_existing_bare_repository() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository_id = repository_id();

    let first = storage.create_repository(&repository_id).await.unwrap();
    let second = storage.create_repository(&repository_id).await.unwrap();

    assert!(first.created);
    assert!(!second.created);
    assert_eq!(first.path, second.path);
}

#[tokio::test]
async fn create_repository_fails_for_existing_non_bare_path() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository_path = storage.repository_path(REPOSITORY_ID).unwrap();
    let repository_id = repository_id();
    fs::create_dir_all(&repository_path).unwrap();
    fs::write(repository_path.join("README.md"), "not bare").unwrap();

    let error = storage.create_repository(&repository_id).await.unwrap_err();

    assert!(matches!(error, RepositoryError::ExistingPathNotBare));
}

#[tokio::test]
async fn create_repository_maps_git_process_failure() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "false");

    let error = storage
        .create_repository(&repository_id())
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::GitProcessFailed));
}

#[cfg(unix)]
#[tokio::test]
async fn create_repository_rejects_repositories_symlink_escape() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    fs::create_dir_all(temp_dir.path()).unwrap();
    std::os::unix::fs::symlink(outside_dir.path(), temp_dir.path().join("repositories")).unwrap();
    let storage = storage(temp_dir.path(), "git");

    let error = storage
        .create_repository(&repository_id())
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

#[cfg(unix)]
#[tokio::test]
async fn create_repository_rejects_repository_leaf_symlink_escape() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    let repository_storage = storage(temp_dir.path(), "git");
    let outside_storage = storage(outside_dir.path(), "git");
    let repository_id = repository_id();
    let outside_repository_path = outside_storage
        .create_repository(&repository_id)
        .await
        .unwrap()
        .path;
    let repository_path = repository_storage.repository_path(REPOSITORY_ID).unwrap();
    fs::create_dir_all(repository_path.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(outside_repository_path, repository_path).unwrap();

    let error = repository_storage
        .create_repository(&repository_id)
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

#[cfg(unix)]
#[tokio::test]
async fn create_repository_rejects_dangling_repository_leaf_symlink() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository_path = storage.repository_path(REPOSITORY_ID).unwrap();
    fs::create_dir_all(repository_path.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(
        temp_dir.path().join("missing-outside-repository.git"),
        repository_path,
    )
    .unwrap();

    let error = storage
        .create_repository(&repository_id())
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

#[cfg(unix)]
#[tokio::test]
async fn create_repository_rejects_existing_bare_repository_with_internal_symlink() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository_id = repository_id();
    let repository_path = storage
        .create_repository(&repository_id)
        .await
        .unwrap()
        .path;
    fs::remove_dir_all(repository_path.join("objects")).unwrap();
    std::os::unix::fs::symlink(outside_dir.path(), repository_path.join("objects")).unwrap();

    let error = storage.create_repository(&repository_id).await.unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

#[cfg(unix)]
#[tokio::test]
async fn create_repository_rejects_repository_path_replaced_by_symlink_before_git_init() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    let git_script = temp_dir.path().join("replace-with-symlink.sh");
    fs::write(
        &git_script,
        format!(
            "#!/bin/sh\nrm -rf \"$3\"\nln -s '{}' \"$3\"\nexit 0\n",
            outside_dir.path().display()
        ),
    )
    .unwrap();
    make_executable(&git_script);
    let storage = storage(temp_dir.path(), git_script.to_str().unwrap());

    let error = storage
        .create_repository(&repository_id())
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

fn repository_id() -> RepositoryId {
    RepositoryId::parse(REPOSITORY_ID).unwrap()
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}
