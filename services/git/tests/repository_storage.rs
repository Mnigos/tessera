use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;
use tessera_git::proto::git_storage_service_server::GitStorageService;
use tessera_git::proto::{
    GetRepositoryRawBlobRequest, ListRepositoryCommitsRequest, ListRepositoryRefsRequest,
};
use tessera_git::storage::infrastructure::RepositoryStorage;
use tessera_git::{
    Config, GitStorageGrpcService, RepositoryBlobPreview, RepositoryError, RepositoryId,
    RepositoryRawBlob, RepositoryRefKind, RepositoryTreeEntryKind,
};
use tonic::{Code, Request};

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

#[tokio::test]
async fn create_repository_cleans_up_directory_after_git_process_failure() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "false");
    let repository_path = storage.repository_path(REPOSITORY_ID).unwrap();

    let error = storage
        .create_repository(&repository_id())
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::GitProcessFailed));
    assert!(!repository_path.exists());
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

#[tokio::test]
async fn browser_summary_returns_empty_state_for_empty_repository() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let default_branch = git_stdout(
        &repository.path,
        ["symbolic-ref", "--quiet", "--short", "HEAD"],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "", "")
        .await
        .unwrap();

    assert!(summary.is_empty);
    assert_eq!(summary.default_branch, default_branch.trim());
    assert!(summary.root_entries.is_empty());
    assert!(summary.readme.is_none());
}

#[tokio::test]
async fn browser_summary_returns_root_entries_without_readme() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[
            ("src/lib.rs", "pub fn hello() {}\n"),
            ("notes.txt", "notes\n"),
        ],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "")
        .await
        .unwrap();

    assert!(!summary.is_empty);
    assert_eq!(summary.default_branch, "main");
    assert_eq!(summary.root_entries.len(), 2);
    assert!(
        summary.root_entries.iter().any(|entry| {
            entry.name == "notes.txt" && entry.kind == RepositoryTreeEntryKind::File
        })
    );
    assert!(
        summary.root_entries.iter().any(|entry| {
            entry.name == "src" && entry.kind == RepositoryTreeEntryKind::Directory
        })
    );
    assert!(summary.readme.is_none());
}

#[tokio::test]
async fn browser_summary_returns_readme_by_priority_and_preserves_filename() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[
            ("README.txt", "lower priority\n"),
            ("README.markdown", "# Chosen\n"),
        ],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "")
        .await
        .unwrap();
    let readme = summary.readme.unwrap();

    assert_eq!(readme.filename, "README.markdown");
    assert_eq!(readme.content, b"# Chosen\n");
    assert!(!readme.is_truncated);
}

#[tokio::test]
async fn browser_summary_matches_readme_case_insensitively() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("readme.md", "# Lowercase\n")],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "")
        .await
        .unwrap();
    let readme = summary.readme.unwrap();

    assert_eq!(readme.filename, "readme.md");
    assert_eq!(readme.content, b"# Lowercase\n");
}

#[tokio::test]
async fn browser_summary_prefers_requested_default_branch_before_symbolic_head() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    push_commit(
        temp_dir.path(),
        &repository.path,
        "develop",
        &[("README.md", "develop\n")],
    );
    git(
        &repository.path,
        ["symbolic-ref", "HEAD", "refs/heads/main"],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "develop", "")
        .await
        .unwrap();

    assert_eq!(summary.default_branch, "develop");
    assert_eq!(summary.readme.unwrap().content, b"develop\n");
}

#[tokio::test]
async fn browser_summary_falls_back_to_symbolic_head_when_requested_branch_is_missing() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "missing", "")
        .await
        .unwrap();

    assert_eq!(summary.default_branch, "main");
    assert_eq!(summary.readme.unwrap().content, b"main\n");
}

#[tokio::test]
async fn repository_refs_lists_branches_with_default_marker() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    push_commit(
        temp_dir.path(),
        &repository.path,
        "develop",
        &[("README.md", "develop\n")],
    );
    git(
        &repository.path,
        ["symbolic-ref", "HEAD", "refs/heads/main"],
    );

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path)
        .await
        .unwrap()
        .refs;

    assert_eq!(refs.len(), 2);
    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Branch
            && repository_ref.display_name == "main"
            && repository_ref.qualified_name == "refs/heads/main"
            && repository_ref.is_default_branch
            && repository_ref.commit_id.len() == 40
    }));
    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Branch
            && repository_ref.display_name == "develop"
            && repository_ref.qualified_name == "refs/heads/develop"
            && !repository_ref.is_default_branch
            && repository_ref.commit_id.len() == 40
    }));
}

#[tokio::test]
async fn repository_refs_lists_lightweight_tag() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    git(&repository.path, ["tag", "v1.0.0", "main"]);
    let commit_id = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path)
        .await
        .unwrap()
        .refs;

    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Tag
            && repository_ref.display_name == "v1.0.0"
            && repository_ref.qualified_name == "refs/tags/v1.0.0"
            && repository_ref.commit_id == commit_id
            && !repository_ref.is_default_branch
    }));
}

#[tokio::test]
async fn repository_refs_peels_annotated_tag_to_commit() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    create_annotated_tag(&repository.path, "release", "main");
    let commit_id = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    let tag_object_id = git_stdout(&repository.path, ["rev-parse", "release"])
        .trim()
        .to_string();

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path)
        .await
        .unwrap()
        .refs;
    let tag = refs
        .iter()
        .find(|repository_ref| repository_ref.display_name == "release")
        .unwrap();

    assert_eq!(tag.kind, RepositoryRefKind::Tag);
    assert_eq!(tag.commit_id, commit_id);
    assert_ne!(tag.commit_id, tag_object_id);
}

#[tokio::test]
async fn repository_refs_returns_empty_list_for_empty_repository() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path)
        .await
        .unwrap();

    assert!(refs.refs.is_empty());
}

#[tokio::test]
async fn browser_summary_uses_selected_branch() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    push_commit(
        temp_dir.path(),
        &repository.path,
        "develop",
        &[("README.md", "develop\n")],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "develop")
        .await
        .unwrap();

    assert_eq!(summary.default_branch, "main");
    assert_eq!(summary.readme.unwrap().content, b"develop\n");
}

#[tokio::test]
async fn browser_summary_uses_selected_tag() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "release\n")],
        "release commit",
    );
    create_annotated_tag(&repository.path, "release", "HEAD");
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "newer\n")],
        "newer commit",
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "release")
        .await
        .unwrap();

    assert_eq!(summary.default_branch, "main");
    assert_eq!(summary.readme.unwrap().content, b"release\n");
}

#[tokio::test]
async fn browser_summary_returns_not_found_for_invalid_selected_ref() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );

    let error = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "missing")
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::RepositoryObjectNotFound));
}

#[tokio::test]
async fn repository_refs_grpc_maps_response() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    let service = grpc_service(temp_dir.path());

    let response = service
        .list_repository_refs(Request::new(ListRepositoryRefsRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path,
        }))
        .await
        .unwrap()
        .into_inner();

    assert_eq!(response.refs.len(), 1);
    assert_eq!(
        response.refs[0].kind,
        tessera_git::proto::RepositoryRefKind::Branch as i32
    );
    assert_eq!(response.refs[0].display_name, "main");
    assert!(response.refs[0].is_default_branch);
}

#[tokio::test]
async fn browser_summary_truncates_oversized_readme() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let content = "a".repeat(256 * 1024 + 7);
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", &content)],
    );

    let summary = storage
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main", "")
        .await
        .unwrap();
    let readme = summary.readme.unwrap();

    assert_eq!(readme.content.len(), 256 * 1024);
    assert!(readme.is_truncated);
}

#[tokio::test]
async fn browser_summary_rejects_unsafe_default_branch() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();

    for branch_name in [
        "../main",
        "main.lock",
        "main.",
        "feature/a b",
        "feature/a\tb",
        "feature/a\rb",
        "feature/a\nb",
        "feature/a~b",
        "feature/a^b",
        "feature/a:b",
        "feature/a?b",
        "feature/a*b",
        "feature/a[b",
    ] {
        let error = storage
            .get_repository_browser_summary(
                REPOSITORY_ID,
                &repository.storage_path,
                branch_name,
                "",
            )
            .await
            .unwrap_err();

        assert!(
            matches!(error, RepositoryError::InvalidRepositoryRef),
            "expected {branch_name:?} to be rejected"
        );
    }
}

#[tokio::test]
async fn repository_tree_returns_root_entries() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[
            ("src/lib.rs", "pub fn hello() {}\n"),
            ("notes.txt", "notes\n"),
        ],
    );

    let tree = storage
        .get_repository_tree(REPOSITORY_ID, &repository.storage_path, "main", "")
        .await
        .unwrap();

    assert_eq!(tree.path, "");
    assert_eq!(tree.entries.len(), 2);
    assert!(tree.entries.iter().any(|entry| {
        entry.name == "notes.txt"
            && entry.path == "notes.txt"
            && entry.kind == RepositoryTreeEntryKind::File
    }));
    assert!(tree.entries.iter().any(|entry| {
        entry.name == "src"
            && entry.path == "src"
            && entry.kind == RepositoryTreeEntryKind::Directory
    }));
}

#[tokio::test]
async fn repository_tree_returns_nested_entries_with_full_paths() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[
            ("src/domain/mod.rs", "pub mod repository;\n"),
            ("src/lib.rs", "pub mod domain;\n"),
        ],
    );

    let tree = storage
        .get_repository_tree(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            "src/domain",
        )
        .await
        .unwrap();

    assert_eq!(tree.path, "src/domain");
    assert_eq!(tree.entries.len(), 1);
    assert_eq!(tree.entries[0].name, "mod.rs");
    assert_eq!(tree.entries[0].path, "src/domain/mod.rs");
    assert_eq!(tree.entries[0].kind, RepositoryTreeEntryKind::File);
}

#[tokio::test]
async fn repository_tree_returns_not_found_for_missing_path() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hi\n")],
    );

    let error = storage
        .get_repository_tree(REPOSITORY_ID, &repository.storage_path, "main", "missing")
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::RepositoryObjectNotFound));
}

#[tokio::test]
async fn repository_tree_rejects_file_path() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hi\n")],
    );

    let error = storage
        .get_repository_tree(REPOSITORY_ID, &repository.storage_path, "main", "README.md")
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::WrongObjectKind));
}

#[tokio::test]
async fn repository_tree_rejects_unsafe_paths() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hi\n")],
    );

    for path in [
        "src//lib.rs",
        "src/../README.md",
        "src/./lib.rs",
        "src\\lib.rs",
        "src\0lib.rs",
    ] {
        let error = storage
            .get_repository_tree(REPOSITORY_ID, &repository.storage_path, "main", path)
            .await
            .unwrap_err();

        assert!(
            matches!(error, RepositoryError::InvalidRepositoryPath),
            "expected {path:?} to be rejected"
        );
    }
}

#[tokio::test]
async fn repository_tree_trims_boundary_slashes() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("src/lib.rs", "pub fn hello() {}\n")],
    );

    let tree = storage
        .get_repository_tree(REPOSITORY_ID, &repository.storage_path, "main", "/src/")
        .await
        .unwrap();

    assert_eq!(tree.path, "src");
    assert_eq!(tree.entries.len(), 1);
    assert_eq!(tree.entries[0].path, "src/lib.rs");
}

#[tokio::test]
async fn repository_tree_rejects_unsafe_refs() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hi\n")],
    );

    for ref_name in [
        "",
        "../main",
        "main.lock",
        "feature/a b",
        "feature/a\\b",
        "feature/.hidden",
    ] {
        let error = storage
            .get_repository_tree(REPOSITORY_ID, &repository.storage_path, ref_name, "")
            .await
            .unwrap_err();

        assert!(
            matches!(error, RepositoryError::InvalidRepositoryRef),
            "expected {ref_name:?} to be rejected"
        );
    }
}

#[tokio::test]
async fn repository_blob_returns_text_preview() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hello\n")],
    );
    let object_id = object_id_for_path(&repository.path, "main", "README.md");

    let blob = storage
        .get_repository_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap();

    assert_eq!(
        blob,
        RepositoryBlobPreview::Text {
            object_id,
            text: "hello\n".to_string(),
            size_bytes: 6,
            preview_limit_bytes: 512 * 1024,
        }
    );
}

#[tokio::test]
async fn repository_blob_detects_binary_preview() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit_bytes(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("image.bin", &[0, 159, 146, 150])],
    );
    let object_id = object_id_for_path(&repository.path, "main", "image.bin");

    let blob = storage
        .get_repository_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap();

    assert_eq!(
        blob,
        RepositoryBlobPreview::Binary {
            object_id,
            size_bytes: 4,
            preview_limit_bytes: 512 * 1024,
        }
    );
}

#[tokio::test]
async fn repository_blob_detects_oversized_preview() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let content = vec![b'a'; 512 * 1024 + 1];
    push_commit_bytes(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("large.txt", &content)],
    );
    let object_id = object_id_for_path(&repository.path, "main", "large.txt");

    let blob = storage
        .get_repository_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap();

    assert_eq!(
        blob,
        RepositoryBlobPreview::TooLarge {
            object_id,
            size_bytes: 512 * 1024 + 1,
            preview_limit_bytes: 512 * 1024,
        }
    );
}

#[tokio::test]
async fn repository_blob_rejects_directory_object() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("src/lib.rs", "hi\n")],
    );
    let object_id = object_id_for_path(&repository.path, "main", "src");

    let error = storage
        .get_repository_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::WrongObjectKind));
}

#[tokio::test]
async fn repository_raw_blob_returns_exact_content() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit_bytes(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("data.bin", &[0, 1, 2, b'\n'])],
    );
    let object_id = object_id_for_path(&repository.path, "main", "data.bin");

    let blob = storage
        .get_repository_raw_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap();

    assert_eq!(
        blob,
        RepositoryRawBlob {
            object_id,
            content: vec![0, 1, 2, b'\n'],
            size_bytes: 4,
        }
    );
}

#[tokio::test]
async fn repository_raw_blob_rejects_missing_object() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let missing_object_id = "0123456789012345678901234567890123456789";

    let error = storage
        .get_repository_raw_blob(REPOSITORY_ID, &repository.storage_path, missing_object_id)
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::RepositoryObjectNotFound));
}

#[tokio::test]
async fn repository_raw_blob_rejects_directory_object() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("src/lib.rs", "hi\n")],
    );
    let object_id = object_id_for_path(&repository.path, "main", "src");

    let error = storage
        .get_repository_raw_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::WrongObjectKind));
}

#[tokio::test]
async fn repository_raw_blob_rejects_oversized_content() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let content = vec![b'a'; 10 * 1024 * 1024 + 1];
    push_commit_bytes(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("large.bin", &content)],
    );
    let object_id = object_id_for_path(&repository.path, "main", "large.bin");

    let error = storage
        .get_repository_raw_blob(REPOSITORY_ID, &repository.storage_path, &object_id)
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::BlobTooLarge));
}

#[tokio::test]
async fn repository_raw_blob_rejects_invalid_object_id() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();

    let error = storage
        .get_repository_raw_blob(REPOSITORY_ID, &repository.storage_path, "../HEAD")
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::InvalidObjectId));
}

#[tokio::test]
async fn repository_raw_blob_grpc_returns_exact_content() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit_bytes(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("data.bin", &[0, 1, 2, b'\n'])],
    );
    let object_id = object_id_for_path(&repository.path, "main", "data.bin");
    let service = grpc_service(temp_dir.path());

    let response = service
        .get_repository_raw_blob(Request::new(GetRepositoryRawBlobRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path,
            object_id: object_id.clone(),
        }))
        .await
        .unwrap()
        .into_inner();

    assert_eq!(response.object_id, object_id);
    assert_eq!(response.content, vec![0, 1, 2, b'\n']);
    assert_eq!(response.size_bytes, 4);
}

#[tokio::test]
async fn repository_raw_blob_grpc_maps_errors_cleanly() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("src/lib.rs", "hi\n")],
    );
    let directory_object_id = object_id_for_path(&repository.path, "main", "src");
    let service = grpc_service(temp_dir.path());

    let missing = service
        .get_repository_raw_blob(Request::new(GetRepositoryRawBlobRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path.clone(),
            object_id: "0123456789012345678901234567890123456789".to_string(),
        }))
        .await
        .unwrap_err();
    let wrong_kind = service
        .get_repository_raw_blob(Request::new(GetRepositoryRawBlobRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path.clone(),
            object_id: directory_object_id,
        }))
        .await
        .unwrap_err();
    let invalid = service
        .get_repository_raw_blob(Request::new(GetRepositoryRawBlobRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path,
            object_id: "../HEAD".to_string(),
        }))
        .await
        .unwrap_err();

    assert_eq!(missing.code(), Code::NotFound);
    assert_eq!(wrong_kind.code(), Code::FailedPrecondition);
    assert_eq!(invalid.code(), Code::InvalidArgument);
}

#[tokio::test]
async fn repository_commits_returns_recent_commits_newest_first() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "first\n")],
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "second\n")],
        "second commit",
    );

    let commit_list = storage
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "main", 50)
        .await
        .unwrap();

    assert_eq!(commit_list.commits.len(), 2);
    assert_eq!(commit_list.commits[0].summary, "second commit");
    assert_ne!(commit_list.commits[0].sha, commit_list.commits[1].sha);
    assert_eq!(
        commit_list.commits[0].sha,
        git_stdout(&repository.path, ["rev-parse", "main"]).trim()
    );
}

#[tokio::test]
async fn repository_commits_returns_empty_list_for_empty_repository() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();

    let commit_list = storage
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "", 50)
        .await
        .unwrap();

    assert!(commit_list.commits.is_empty());
}

#[tokio::test]
async fn repository_commits_rejects_unsafe_refs() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hi\n")],
    );

    for ref_name in ["../main", "main.lock", "feature/a b", "feature/.hidden"] {
        let error = storage
            .list_repository_commits(REPOSITORY_ID, &repository.storage_path, ref_name, 50)
            .await
            .unwrap_err();

        assert!(
            matches!(error, RepositoryError::InvalidRepositoryRef),
            "expected {ref_name:?} to be rejected"
        );
    }
}

#[tokio::test]
async fn repository_commits_preserves_author_and_committer_metadata() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit_with_metadata(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", b"metadata\n")],
        CommitMetadata {
            message: "Preserve identities",
            author_name: "Ada Author",
            author_email: "ada@example.com",
            author_date: "2026-05-16T10:00:00+00:00",
            committer_name: "Grace Committer",
            committer_email: "grace@example.com",
            committer_date: "2026-05-16T10:01:00+00:00",
        },
    );

    let commit_list = storage
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "main", 50)
        .await
        .unwrap();
    let commit = &commit_list.commits[0];

    assert_eq!(commit.sha.len(), 40);
    assert_eq!(commit.short_sha, &commit.sha[..7]);
    assert_eq!(commit.summary, "Preserve identities");
    assert_eq!(commit.author.name, "Ada Author");
    assert_eq!(commit.author.email, "ada@example.com");
    assert_utc_git_date_eq(&commit.author.date, "2026-05-16T10:00:00");
    assert_eq!(commit.committer.name, "Grace Committer");
    assert_eq!(commit.committer.email, "grace@example.com");
    assert_utc_git_date_eq(&commit.committer.date, "2026-05-16T10:01:00");
}

#[tokio::test]
async fn repository_commits_grpc_maps_response_and_invalid_ref() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "hi\n")],
    );
    let service = grpc_service(temp_dir.path());

    let response = service
        .list_repository_commits(Request::new(ListRepositoryCommitsRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path.clone(),
            r#ref: "main".to_string(),
            limit: 50,
        }))
        .await
        .unwrap()
        .into_inner();
    let invalid = service
        .list_repository_commits(Request::new(ListRepositoryCommitsRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path,
            r#ref: "../main".to_string(),
            limit: 50,
        }))
        .await
        .unwrap_err();

    assert_eq!(response.commits.len(), 1);
    assert_eq!(response.commits[0].summary, "test commit");
    assert!(response.commits[0].author.is_some());
    assert!(response.commits[0].committer.is_some());
    assert_eq!(invalid.code(), Code::InvalidArgument);
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

fn grpc_service(storage_root: &Path) -> GitStorageGrpcService {
    GitStorageGrpcService::new(Config {
        host: "::".to_string(),
        port: 50051,
        http_host: "::".to_string(),
        http_port: 50052,
        storage_root: storage_root.to_path_buf(),
        git_binary: PathBuf::from("git"),
        api_grpc_url: "http://localhost:50053".to_string(),
        api_grpc_authorization_token: Some("test-internal-token".to_string()),
    })
}

fn repository_id() -> RepositoryId {
    RepositoryId::parse(REPOSITORY_ID).unwrap()
}

fn push_commit(
    temp_root: &Path,
    bare_repository_path: &Path,
    branch_name: &str,
    files: &[(&str, &str)],
) {
    let files: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(file_path, content)| (*file_path, content.as_bytes()))
        .collect();
    push_commit_bytes(temp_root, bare_repository_path, branch_name, &files);
}

fn push_commit_bytes(
    temp_root: &Path,
    bare_repository_path: &Path,
    branch_name: &str,
    files: &[(&str, &[u8])],
) {
    push_commit_with_metadata(
        temp_root,
        bare_repository_path,
        branch_name,
        files,
        CommitMetadata {
            message: "test commit",
            author_name: "Tessera Test",
            author_email: "test@example.com",
            author_date: "2026-05-16T10:00:00+00:00",
            committer_name: "Tessera Test",
            committer_email: "test@example.com",
            committer_date: "2026-05-16T10:00:00+00:00",
        },
    );
}

struct CommitMetadata<'a> {
    message: &'a str,
    author_name: &'a str,
    author_email: &'a str,
    author_date: &'a str,
    committer_name: &'a str,
    committer_email: &'a str,
    committer_date: &'a str,
}

fn push_commit_with_metadata(
    temp_root: &Path,
    bare_repository_path: &Path,
    branch_name: &str,
    files: &[(&str, &[u8])],
    metadata: CommitMetadata,
) {
    let worktree = TempDir::new_in(temp_root).unwrap();
    command(
        worktree.path(),
        ["git", "init", "--initial-branch", branch_name],
    );
    command(
        worktree.path(),
        ["git", "config", "user.name", metadata.committer_name],
    );
    command(
        worktree.path(),
        ["git", "config", "user.email", metadata.committer_email],
    );

    for (file_path, content) in files {
        let path = worktree.path().join(file_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    command(worktree.path(), ["git", "add", "."]);
    command_with_env(
        worktree.path(),
        ["git", "commit", "-m", metadata.message],
        &[
            ("GIT_AUTHOR_NAME", metadata.author_name),
            ("GIT_AUTHOR_EMAIL", metadata.author_email),
            ("GIT_AUTHOR_DATE", metadata.author_date),
            ("GIT_COMMITTER_NAME", metadata.committer_name),
            ("GIT_COMMITTER_EMAIL", metadata.committer_email),
            ("GIT_COMMITTER_DATE", metadata.committer_date),
        ],
    );
    command(
        worktree.path(),
        [
            "git",
            "push",
            bare_repository_path.to_str().unwrap(),
            &format!("HEAD:refs/heads/{branch_name}"),
        ],
    );
    git(
        bare_repository_path,
        ["symbolic-ref", "HEAD", &format!("refs/heads/{branch_name}")],
    );
}

fn append_commit(
    temp_root: &Path,
    bare_repository_path: &Path,
    branch_name: &str,
    files: &[(&str, &str)],
    message: &str,
) {
    let files: Vec<(&str, &[u8])> = files
        .iter()
        .map(|(file_path, content)| (*file_path, content.as_bytes()))
        .collect();
    let worktree = TempDir::new_in(temp_root).unwrap();
    command(
        worktree.path(),
        [
            "git",
            "clone",
            "--branch",
            branch_name,
            bare_repository_path.to_str().unwrap(),
            ".",
        ],
    );
    command(
        worktree.path(),
        ["git", "config", "user.name", "Tessera Test"],
    );
    command(
        worktree.path(),
        ["git", "config", "user.email", "test@example.com"],
    );

    for (file_path, content) in files {
        let path = worktree.path().join(file_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    command(worktree.path(), ["git", "add", "."]);
    command_with_env(
        worktree.path(),
        ["git", "commit", "-m", message],
        &[
            ("GIT_AUTHOR_DATE", "2026-05-16T10:02:00+00:00"),
            ("GIT_COMMITTER_DATE", "2026-05-16T10:02:00+00:00"),
        ],
    );
    command(worktree.path(), ["git", "push", "origin", branch_name]);
}

fn object_id_for_path(bare_repository_path: &Path, branch_name: &str, path: &str) -> String {
    let output = git_stdout(
        bare_repository_path,
        ["rev-parse", &format!("{branch_name}:{path}")],
    );

    output.trim().to_string()
}

fn create_annotated_tag(bare_repository_path: &Path, tag_name: &str, target: &str) {
    command_with_env(
        Path::new("."),
        [
            "git",
            "--git-dir",
            bare_repository_path.to_str().unwrap(),
            "tag",
            "-a",
            tag_name,
            target,
            "-m",
            tag_name,
        ],
        &[
            ("GIT_COMMITTER_NAME", "Tessera Test"),
            ("GIT_COMMITTER_EMAIL", "test@example.com"),
            ("GIT_COMMITTER_DATE", "2026-05-16T10:03:00+00:00"),
        ],
    );
}

fn git<const N: usize>(bare_repository_path: &Path, args: [&str; N]) {
    let mut command_args = vec!["git", "--git-dir", bare_repository_path.to_str().unwrap()];
    command_args.extend(args);
    command_vec(Path::new("."), command_args);
}

fn git_stdout<const N: usize>(bare_repository_path: &Path, args: [&str; N]) -> String {
    let mut command_args = vec!["git", "--git-dir", bare_repository_path.to_str().unwrap()];
    command_args.extend(args);
    let output = command_output(Path::new("."), command_args);

    String::from_utf8(output.stdout).unwrap()
}

fn assert_utc_git_date_eq(actual: &str, expected_time: &str) {
    assert!(
        actual == format!("{expected_time}Z") || actual == format!("{expected_time}+00:00"),
        "expected {actual:?} to represent {expected_time} UTC"
    );
}

fn command<const N: usize>(current_dir: &Path, args: [&str; N]) {
    command_vec(current_dir, args);
}

fn command_with_env<const N: usize>(current_dir: &Path, args: [&str; N], envs: &[(&str, &str)]) {
    let output = Command::new(args[0])
        .current_dir(current_dir)
        .args(&args[1..])
        .envs(envs.iter().copied())
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "command failed: {:?}\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn command_vec<'a, T>(current_dir: &Path, args: T)
where
    T: IntoIterator<Item = &'a str>,
{
    command_output(current_dir, args);
}

fn command_output<'a, T>(current_dir: &Path, args: T) -> std::process::Output
where
    T: IntoIterator<Item = &'a str>,
{
    let args: Vec<&str> = args.into_iter().collect();
    let output = Command::new(args[0])
        .current_dir(current_dir)
        .args(&args[1..])
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "command failed: {:?}\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    output
}

#[cfg(unix)]
fn make_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    let mut permissions = fs::metadata(path).unwrap().permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).unwrap();
}
