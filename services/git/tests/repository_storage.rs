use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;
use tessera_git::proto::git_storage_service_server::GitStorageService;
use tessera_git::proto::{
    CheckRepositoryMergeabilityRequest, GetRepositoryRawBlobRequest, ListRepositoryCommitsRequest,
    ListRepositoryRefsRequest,
};
use tessera_git::storage::infrastructure::RepositoryStorage;
use tessera_git::{
    Config, GitStorageGrpcService, RepositoryBlobPreview, RepositoryChangedFileStatus,
    RepositoryDiffLineKind, RepositoryError, RepositoryId, RepositoryMergeRequest,
    RepositoryMergeStrategy, RepositoryMergeStrategyUnavailableReason, RepositoryMergeability,
    RepositoryRawBlob, RepositoryRefKind, RepositorySignatureState, RepositoryTreeEntryKind,
    TrustedGpgKey,
};
use tonic::{Code, Request};

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";
const OPERATION_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4c7";

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
async fn import_repository_mirrors_local_history_refs_and_default_branch() {
    let temp_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    push_commit(
        temp_dir.path(),
        &source_repository_path,
        "main",
        &[("README.md", "main\n")],
    );
    push_commit(
        temp_dir.path(),
        &source_repository_path,
        "develop",
        &[("README.md", "develop\n")],
    );
    git(&source_repository_path, ["tag", "v1.0.0", "main"]);
    git(
        &source_repository_path,
        ["symbolic-ref", "HEAD", "refs/heads/main"],
    );
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let storage_path = storage
        .repository_path(REPOSITORY_ID)
        .unwrap()
        .display()
        .to_string();

    let imported = storage
        .import_repository(
            &repository_id(),
            &storage_path,
            source_repository_path.to_str().unwrap(),
            None,
            "develop",
        )
        .await
        .unwrap();
    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &imported.storage_path, &[])
        .await
        .unwrap()
        .refs;

    assert_eq!(imported.default_branch, "develop");
    assert_eq!(
        git_stdout(
            &storage.repository_path(REPOSITORY_ID).unwrap(),
            ["symbolic-ref", "--short", "HEAD"]
        )
        .trim(),
        "develop"
    );
    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Branch
            && repository_ref.display_name == "main"
            && repository_ref.commit_id.len() == 40
    }));
    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Branch
            && repository_ref.display_name == "develop"
            && repository_ref.is_default_branch
            && repository_ref.commit_id.len() == 40
    }));
    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Tag
            && repository_ref.display_name == "v1.0.0"
            && repository_ref.qualified_name == "refs/tags/v1.0.0"
    }));
}

#[tokio::test]
async fn import_repository_preserves_author_and_committer_metadata() {
    let temp_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    push_commit_with_metadata(
        temp_dir.path(),
        &source_repository_path,
        "main",
        &[("README.md", b"metadata\n")],
        CommitMetadata {
            message: "metadata commit",
            author_name: "Ada Author",
            author_email: "ada@example.com",
            author_date: "2026-05-16T10:00:00+00:00",
            committer_name: "Grace Committer",
            committer_email: "grace@example.com",
            committer_date: "2026-05-16T10:01:00+00:00",
        },
    );
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let storage_path = storage
        .repository_path(REPOSITORY_ID)
        .unwrap()
        .display()
        .to_string();

    let imported = storage
        .import_repository(
            &repository_id(),
            &storage_path,
            source_repository_path.to_str().unwrap(),
            None,
            "",
        )
        .await
        .unwrap();
    let commits = storage
        .list_repository_commits(REPOSITORY_ID, &imported.storage_path, "main", 10, &[])
        .await
        .unwrap()
        .commits;

    assert_eq!(commits[0].author.name, "Ada Author");
    assert_eq!(commits[0].author.email, "ada@example.com");
    assert_utc_git_date_eq(&commits[0].author.date, "2026-05-16T10:00:00");
    assert_eq!(commits[0].committer.name, "Grace Committer");
    assert_eq!(commits[0].committer.email, "grace@example.com");
    assert_utc_git_date_eq(&commits[0].committer.date, "2026-05-16T10:01:00");
}

#[tokio::test]
async fn import_repository_uses_default_branch_hint_for_empty_repository() {
    let temp_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let storage_path = storage
        .repository_path(REPOSITORY_ID)
        .unwrap()
        .display()
        .to_string();

    let imported = storage
        .import_repository(
            &repository_id(),
            &storage_path,
            source_repository_path.to_str().unwrap(),
            None,
            "main",
        )
        .await
        .unwrap();

    assert_eq!(imported.default_branch, "main");
    assert_eq!(
        git_stdout(
            &storage.repository_path(REPOSITORY_ID).unwrap(),
            ["symbolic-ref", "HEAD"]
        )
        .trim(),
        "refs/heads/main"
    );
}

#[tokio::test]
async fn import_repository_passes_access_token_as_basic_auth_header() {
    let temp_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    let auth_header_path = temp_dir.path().join("auth-header.txt");
    let git_script = temp_dir.path().join("git-wrapper.sh");
    create_bare_repository(&source_repository_path, "main");
    push_commit(
        temp_dir.path(),
        &source_repository_path,
        "main",
        &[("README.md", "auth\n")],
    );
    fs::write(
		&git_script,
		format!(
			"#!/bin/sh\nif [ -n \"$GIT_CONFIG_VALUE_0\" ]; then printf '%s' \"$GIT_CONFIG_VALUE_0\" > '{}'; fi\nexec git \"$@\"\n",
			auth_header_path.display()
		),
	)
	.unwrap();
    make_executable(&git_script);
    let storage = storage(
        temp_dir.path().join("storage").as_path(),
        git_script.to_str().unwrap(),
    );
    let storage_path = storage
        .repository_path(REPOSITORY_ID)
        .unwrap()
        .display()
        .to_string();

    storage
        .import_repository(
            &repository_id(),
            &storage_path,
            source_repository_path.to_str().unwrap(),
            Some("secret-token"),
            "main",
        )
        .await
        .unwrap();

    assert_eq!(
        fs::read_to_string(auth_header_path).unwrap(),
        "Authorization: Basic eC1hY2Nlc3MtdG9rZW46c2VjcmV0LXRva2Vu"
    );
}

#[tokio::test]
async fn push_repository_mirror_pushes_heads_and_tags_to_target() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let target_repository_path = temp_dir.path().join("target.git");
    create_bare_repository(&target_repository_path, "main");
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
    git(&repository.path, ["tag", "v1.0.0", "main"]);

    storage
        .push_repository_mirror(
            &repository_id(),
            &repository.storage_path,
            target_repository_path.to_str().unwrap(),
            None,
        )
        .await
        .unwrap();

    assert_eq!(
        git_stdout(&target_repository_path, ["rev-parse", "refs/heads/main"]),
        git_stdout(&repository.path, ["rev-parse", "refs/heads/main"])
    );
    assert_eq!(
        git_stdout(&target_repository_path, ["rev-parse", "refs/heads/develop"]),
        git_stdout(&repository.path, ["rev-parse", "refs/heads/develop"])
    );
    assert_eq!(
        git_stdout(&target_repository_path, ["rev-parse", "refs/tags/v1.0.0"]),
        git_stdout(&repository.path, ["rev-parse", "refs/tags/v1.0.0"])
    );
}

#[tokio::test]
async fn push_repository_mirror_rejects_option_like_target_url() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();

    let error = storage
        .push_repository_mirror(
            &repository_id(),
            &repository.storage_path,
            "--upload-pack=/tmp/unsafe",
            None,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::InvalidRepositoryPath));
}

#[tokio::test]
async fn push_repository_mirror_rejects_non_fast_forward_target() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let target_repository_path = temp_dir.path().join("target.git");
    create_bare_repository(&target_repository_path, "main");
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "source\n")],
    );
    storage
        .push_repository_mirror(
            &repository_id(),
            &repository.storage_path,
            target_repository_path.to_str().unwrap(),
            None,
        )
        .await
        .unwrap();
    append_commit(
        temp_dir.path(),
        &target_repository_path,
        "main",
        &[("README.md", "target\n")],
        "target-only commit",
    );
    let target_commit = git_stdout(&target_repository_path, ["rev-parse", "refs/heads/main"]);

    let error = storage
        .push_repository_mirror(
            &repository_id(),
            &repository.storage_path,
            target_repository_path.to_str().unwrap(),
            None,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::InvalidRepositoryRef));
    assert_eq!(
        git_stdout(&target_repository_path, ["rev-parse", "refs/heads/main"]),
        target_commit
    );
}

#[tokio::test]
async fn push_repository_mirror_does_not_delete_target_only_refs() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let target_repository_path = temp_dir.path().join("target.git");
    create_bare_repository(&target_repository_path, "main");
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "source\n")],
    );
    push_commit(
        temp_dir.path(),
        &target_repository_path,
        "stale",
        &[("README.md", "stale\n")],
    );
    let stale_commit = git_stdout(&target_repository_path, ["rev-parse", "refs/heads/stale"]);

    storage
        .push_repository_mirror(
            &repository_id(),
            &repository.storage_path,
            target_repository_path.to_str().unwrap(),
            None,
        )
        .await
        .unwrap();

    assert_eq!(
        git_stdout(&target_repository_path, ["rev-parse", "refs/heads/stale"]),
        stale_commit
    );
}

#[tokio::test]
async fn import_repository_rejects_storage_path_mismatch() {
    let temp_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");

    let error = storage
        .import_repository(
            &repository_id(),
            "/tmp/wrong/repository.git",
            source_repository_path.to_str().unwrap(),
            None,
            "",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::StoragePathMismatch));
}

#[tokio::test]
async fn import_repository_rejects_existing_non_bare_path() {
    let temp_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let repository_path = storage.repository_path(REPOSITORY_ID).unwrap();
    fs::create_dir_all(&repository_path).unwrap();
    fs::write(repository_path.join("README.md"), "not bare").unwrap();

    let error = storage
        .import_repository(
            &repository_id(),
            &repository_path.display().to_string(),
            source_repository_path.to_str().unwrap(),
            None,
            "",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::ExistingPathNotBare));
}

#[cfg(unix)]
#[tokio::test]
async fn import_repository_rejects_repositories_symlink_escape() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    std::os::unix::fs::symlink(outside_dir.path(), temp_dir.path().join("repositories")).unwrap();
    let storage = storage(temp_dir.path(), "git");
    let storage_path = storage
        .repository_path(REPOSITORY_ID)
        .unwrap()
        .display()
        .to_string();

    let error = storage
        .import_repository(
            &repository_id(),
            &storage_path,
            source_repository_path.to_str().unwrap(),
            None,
            "",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

#[cfg(unix)]
#[tokio::test]
async fn import_repository_rejects_repository_leaf_symlink_escape() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    let repository_storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let outside_storage = storage(outside_dir.path(), "git");
    let repository_id = repository_id();
    let outside_repository_path = outside_storage
        .create_repository(&repository_id)
        .await
        .unwrap()
        .path;
    let repository_path = repository_storage.repository_path(REPOSITORY_ID).unwrap();
    fs::create_dir_all(repository_path.parent().unwrap()).unwrap();
    std::os::unix::fs::symlink(outside_repository_path, &repository_path).unwrap();

    let error = repository_storage
        .import_repository(
            &repository_id,
            &repository_path.display().to_string(),
            source_repository_path.to_str().unwrap(),
            None,
            "",
        )
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::PathEscapesStorageRoot));
}

#[cfg(unix)]
#[tokio::test]
async fn import_repository_rejects_existing_bare_repository_with_internal_symlink() {
    let temp_dir = TempDir::new().unwrap();
    let outside_dir = TempDir::new().unwrap();
    let source_repository_path = temp_dir.path().join("source.git");
    create_bare_repository(&source_repository_path, "main");
    let storage = storage(temp_dir.path().join("storage").as_path(), "git");
    let repository_id = repository_id();
    let repository = storage.create_repository(&repository_id).await.unwrap();
    fs::remove_dir_all(repository.path.join("objects")).unwrap();
    std::os::unix::fs::symlink(outside_dir.path(), repository.path.join("objects")).unwrap();

    let error = storage
        .import_repository(
            &repository_id,
            &repository.storage_path,
            source_repository_path.to_str().unwrap(),
            None,
            "",
        )
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
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path, &[])
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
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path, &[])
        .await
        .unwrap()
        .refs;

    assert!(refs.iter().any(|repository_ref| {
        repository_ref.kind == RepositoryRefKind::Tag
            && repository_ref.display_name == "v1.0.0"
            && repository_ref.qualified_name == "refs/tags/v1.0.0"
            && repository_ref.commit_id == commit_id
            && !repository_ref.is_default_branch
            && repository_ref.signature.state == RepositorySignatureState::Unsigned
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
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path, &[])
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
    assert_eq!(tag.signature.state, RepositorySignatureState::Unsigned);
}

#[tokio::test]
async fn repository_refs_trusts_signed_tag_when_public_key_is_imported() {
    let Some(gpg_key) = generate_gpg_key() else {
        return;
    };
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_signed_commit_and_tag(
        temp_dir.path(),
        &repository.path,
        "main",
        "signed-v1.0.0",
        &gpg_key,
    );

    let refs = storage
        .list_repository_refs(
            REPOSITORY_ID,
            &repository.storage_path,
            &[gpg_key.trusted_key()],
        )
        .await
        .unwrap()
        .refs;
    let tag = refs
        .iter()
        .find(|repository_ref| repository_ref.display_name == "signed-v1.0.0")
        .unwrap();

    assert_eq!(tag.signature.state, RepositorySignatureState::Trusted);
    assert_eq!(tag.signature.fingerprint, gpg_key.fingerprint);
}

#[tokio::test]
async fn repository_refs_uses_empty_isolated_keyring_without_trusted_keys() {
    let Some(gpg_key) = generate_gpg_key() else {
        return;
    };
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_signed_commit_and_tag(
        temp_dir.path(),
        &repository.path,
        "main",
        "signed-v1.0.0",
        &gpg_key,
    );

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path, &[])
        .await
        .unwrap()
        .refs;
    let tag = refs
        .iter()
        .find(|repository_ref| repository_ref.display_name == "signed-v1.0.0")
        .unwrap();

    assert_ne!(tag.signature.state, RepositorySignatureState::Trusted);
    assert_ne!(tag.signature.state, RepositorySignatureState::Valid);
}

#[tokio::test]
async fn repository_refs_skips_non_commit_tags() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
    );
    let readme_object_id = object_id_for_path(&repository.path, "main", "README.md");
    git(&repository.path, ["tag", "blob-tag", &readme_object_id]);

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path, &[])
        .await
        .unwrap()
        .refs;

    assert!(
        refs.iter()
            .all(|repository_ref| repository_ref.display_name != "blob-tag")
    );
}

#[tokio::test]
async fn repository_refs_returns_empty_list_for_empty_repository() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();

    let refs = storage
        .list_repository_refs(REPOSITORY_ID, &repository.storage_path, &[])
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
            trusted_gpg_keys: Vec::new(),
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
            preview_limit_bytes: 1024 * 1024,
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
            preview_limit_bytes: 1024 * 1024,
        }
    );
}

#[tokio::test]
async fn repository_blob_detects_oversized_preview() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let content = vec![b'a'; 1024 * 1024 + 1];
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
            size_bytes: 1024 * 1024 + 1,
            preview_limit_bytes: 1024 * 1024,
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
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "main", 50, &[])
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
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "", 50, &[])
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
            .list_repository_commits(REPOSITORY_ID, &repository.storage_path, ref_name, 50, &[])
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
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "main", 50, &[])
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
async fn repository_commits_trusts_signed_commit_when_public_key_is_imported() {
    let Some(gpg_key) = generate_gpg_key() else {
        return;
    };
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_signed_commit_and_tag(
        temp_dir.path(),
        &repository.path,
        "main",
        "signed-v1.0.0",
        &gpg_key,
    );

    let commit_list = storage
        .list_repository_commits(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            50,
            &[gpg_key.trusted_key()],
        )
        .await
        .unwrap();

    assert_eq!(
        commit_list.commits[0].signature.state,
        RepositorySignatureState::Trusted
    );
    assert_eq!(
        commit_list.commits[0].signature.fingerprint,
        gpg_key.fingerprint
    );
}

#[tokio::test]
async fn repository_commits_uses_empty_isolated_keyring_without_trusted_keys() {
    let Some(gpg_key) = generate_gpg_key() else {
        return;
    };
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_signed_commit_and_tag(
        temp_dir.path(),
        &repository.path,
        "main",
        "signed-v1.0.0",
        &gpg_key,
    );

    let commit_list = storage
        .list_repository_commits(REPOSITORY_ID, &repository.storage_path, "main", 50, &[])
        .await
        .unwrap();

    assert_ne!(
        commit_list.commits[0].signature.state,
        RepositorySignatureState::Trusted
    );
    assert_ne!(
        commit_list.commits[0].signature.state,
        RepositorySignatureState::Valid
    );
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
            trusted_gpg_keys: Vec::new(),
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
            trusted_gpg_keys: Vec::new(),
        }))
        .await
        .unwrap_err();

    assert_eq!(response.commits.len(), 1);
    assert_eq!(response.commits[0].summary, "test commit");
    assert!(response.commits[0].author.is_some());
    assert!(response.commits[0].committer.is_some());
    assert_eq!(
        response.commits[0].signature.as_ref().unwrap().state,
        tessera_git::proto::RepositorySignatureState::Unsigned as i32
    );
    assert_eq!(invalid.code(), Code::InvalidArgument);
}

#[tokio::test]
async fn repository_comparison_separates_a_missing_revision_from_a_malformed_ref() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );

    let missing = storage
        .compare_repository_refs(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            &"a".repeat(40),
        )
        .await
        .unwrap_err();
    let malformed = storage
        .compare_repository_refs(REPOSITORY_ID, &repository.storage_path, "main", "../main")
        .await
        .unwrap_err();

    assert!(matches!(missing, RepositoryError::RepositoryObjectNotFound));
    assert!(matches!(malformed, RepositoryError::InvalidRepositoryRef));
}

#[tokio::test]
async fn repository_comparison_returns_commits_files_hunks_renames_and_binary_state() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n"), ("old.txt", "rename me\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    let worktree = clone_branch(temp_dir.path(), &repository.path, "feature");
    fs::write(worktree.path().join("README.md"), "base\nfeature\n").unwrap();
    fs::rename(
        worktree.path().join("old.txt"),
        worktree.path().join("new.txt"),
    )
    .unwrap();
    fs::write(worktree.path().join("image.bin"), [0, 1, 2, 3]).unwrap();
    command(worktree.path(), ["git", "add", "-A"]);
    command(worktree.path(), ["git", "commit", "-m", "feature change"]);
    command(worktree.path(), ["git", "push", "origin", "feature"]);

    let comparison = storage
        .compare_repository_refs(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert_eq!(comparison.commits.len(), 1);
    assert_eq!(comparison.commits[0].summary, "feature change");
    assert_eq!(comparison.base_sha, comparison.merge_base_sha);
    assert_eq!(comparison.files.len(), 3);
    assert!(comparison.files.iter().any(|file| {
        file.status == RepositoryChangedFileStatus::Renamed
            && file.old_path == "old.txt"
            && file.new_path == "new.txt"
    }));
    assert!(comparison.files.iter().any(|file| {
        file.status == RepositoryChangedFileStatus::Added
            && file.new_path == "image.bin"
            && file.is_binary
    }));

    let diff = storage
        .get_repository_file_diff(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            "feature",
            "README.md",
        )
        .await
        .unwrap();

    assert_eq!(diff.hunks.len(), 1);
    assert!(diff.hunks[0].lines.iter().any(|line| {
        line.kind == RepositoryDiffLineKind::Addition
            && line.content == "feature"
            && line.new_line == Some(2)
    }));

    let rename_diff = storage
        .get_repository_file_diff(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            "feature",
            "new.txt",
        )
        .await
        .unwrap();
    assert_eq!(
        rename_diff.file.status,
        RepositoryChangedFileStatus::Renamed
    );
    assert_eq!(rename_diff.file.old_path, "old.txt");
    assert_eq!(rename_diff.file.new_path, "new.txt");
}

#[tokio::test]
async fn repository_comparison_rejects_unsafe_refs_and_truncates_large_file_lists() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);

    let error = storage
        .compare_repository_refs(
            REPOSITORY_ID,
            &repository.storage_path,
            "../main",
            "feature",
        )
        .await
        .unwrap_err();
    assert!(matches!(error, RepositoryError::InvalidRepositoryRef));

    let worktree = clone_branch(temp_dir.path(), &repository.path, "feature");
    for index in 0..301 {
        fs::write(
            worktree.path().join(format!("file-{index}.txt")),
            "content\n",
        )
        .unwrap();
    }
    command(worktree.path(), ["git", "add", "."]);
    command(worktree.path(), ["git", "commit", "-m", "many files"]);
    command(worktree.path(), ["git", "push", "origin", "feature"]);

    let comparison = storage
        .compare_repository_refs(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert!(comparison.is_truncated);
    assert_eq!(comparison.file_limit, 300);
    assert_eq!(comparison.files.len(), 300);
}

#[tokio::test]
async fn repository_file_diff_streams_and_truncates_oversized_patches() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("large.txt", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    let worktree = clone_branch(temp_dir.path(), &repository.path, "feature");
    fs::write(
        worktree.path().join("large.txt"),
        "feature line\n".repeat(180_000),
    )
    .unwrap();
    command(worktree.path(), ["git", "add", "large.txt"]);
    command(worktree.path(), ["git", "commit", "-m", "large patch"]);
    command(worktree.path(), ["git", "push", "origin", "feature"]);

    let diff = storage
        .get_repository_file_diff(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            "feature",
            "large.txt",
        )
        .await
        .unwrap();

    assert!(diff.is_truncated);
    assert_eq!(diff.patch_limit_bytes, 2 * 1024 * 1024);
    assert!(!diff.hunks.is_empty());
}

#[tokio::test]
async fn repository_merge_creates_two_parent_commit_and_is_idempotent() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "feature commit",
    );
    let base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    let head_sha = git_stdout(&repository.path, ["rev-parse", "feature"])
        .trim()
        .to_string();

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap();
    let retried = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap();
    // The receipt records which tips this operation merged, so a retry naming a
    // different pair is describing a merge that never happened under this
    // identifier — no matter that the target is exactly where the first attempt
    // left it.
    let mismatched_retry = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &merged.resulting_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap_err();

    assert_eq!(merged, retried);
    assert!(matches!(
        mismatched_retry,
        RepositoryError::StaleRepositoryRef
    ));
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "main"]).trim(),
        merged.resulting_sha
    );
    let parents = git_stdout(
        &repository.path,
        ["show", "-s", "--format=%P", &merged.resulting_sha],
    );
    assert_eq!(parents.split_whitespace().count(), 2);
    assert!(parents.contains(&base_sha));
    assert!(parents.contains(&head_sha));
    assert_eq!(
        git_stdout(
            &repository.path,
            ["show", "-s", "--format=%an <%ae>", &merged.resulting_sha],
        )
        .trim(),
        "Ada <ada@example.com>"
    );

    let comparison = storage
        .compare_repository_refs(
            REPOSITORY_ID,
            &repository.storage_path,
            &format!("{}^1", merged.resulting_sha),
            &format!("{}^2", merged.resulting_sha),
        )
        .await
        .unwrap();
    assert_eq!(comparison.commits.len(), 1);
    assert_eq!(comparison.files.len(), 1);

    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("after.txt", "after\n")],
        "advance target after merge",
    );
    let recovered = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap();
    assert_eq!(recovered, merged);
}

#[cfg(unix)]
#[tokio::test]
async fn repository_merge_maps_update_ref_failure_without_ref_movement() {
    let temp_dir = TempDir::new().unwrap();
    let repository_storage = storage(temp_dir.path(), "git");
    let repository = repository_storage
        .create_repository(&repository_id())
        .await
        .unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "feature commit",
    );
    let base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    let head_sha = git_stdout(&repository.path, ["rev-parse", "feature"])
        .trim()
        .to_string();
    let git_script = temp_dir.path().join("fail-update-ref.sh");
    fs::write(
        &git_script,
        "#!/bin/sh\nfor argument in \"$@\"; do\n\tif [ \"$argument\" = \"update-ref\" ]; then\n\t\tprintf 'forced update-ref failure\\n' >&2\n\t\texit 2\n\tfi\ndone\nexec git \"$@\"\n",
    )
    .unwrap();
    make_executable(&git_script);
    let failing_storage = storage(temp_dir.path(), git_script.to_str().unwrap());

    let error = failing_storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::GitProcessFailed));
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "main"]).trim(),
        base_sha
    );
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "feature"]).trim(),
        head_sha
    );
    // The receipt is created in the same transaction as the target, so a
    // transaction that did not happen leaves no claim that it did.
    assert!(!ref_exists(&repository.path, &operation_receipt_ref()));
}

#[tokio::test]
async fn repository_merge_rejects_stale_refs_and_conflicting_trees() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
        "main change",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("README.md", "feature\n")],
        "feature change",
    );
    let base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    let head_sha = git_stdout(&repository.path, ["rev-parse", "feature"])
        .trim()
        .to_string();

    let stale = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &"0".repeat(40),
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap_err();
    assert!(matches!(stale, RepositoryError::StaleRepositoryRef));

    let conflict = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap_err();
    assert!(matches!(conflict, RepositoryError::MergeConflict));
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "main"]).trim(),
        base_sha
    );
}

#[tokio::test]
async fn repository_mergeability_reports_clean_refs_without_writing() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    let merge_base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("main.txt", "main\n")],
        "main commit",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "feature commit",
    );
    let base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    let head_sha = git_stdout(&repository.path, ["rev-parse", "feature"])
        .trim()
        .to_string();
    let commit_count = git_stdout(&repository.path, ["rev-list", "--all", "--count"])
        .trim()
        .to_string();

    let mergeability = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert!(mergeability.mergeable);
    assert_eq!(mergeability.base_sha, base_sha);
    assert_eq!(mergeability.head_sha, head_sha);
    assert_eq!(mergeability.merge_base_sha, merge_base_sha);
    assert!(mergeability.conflict_paths.is_empty());
    assert!(!mergeability.conflict_paths_truncated);
    assert_eq!(mergeability.conflict_path_limit, 50);
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "main"]).trim(),
        base_sha
    );
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "feature"]).trim(),
        head_sha
    );
    assert_eq!(
        git_stdout(&repository.path, ["rev-list", "--all", "--count"]).trim(),
        commit_count
    );
}

#[tokio::test]
async fn repository_mergeability_bounds_conflict_paths() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    let conflicting_paths: Vec<String> = (0..60).map(|index| format!("src/{index}.txt")).collect();
    let base_files: Vec<(&str, &str)> = conflicting_paths
        .iter()
        .map(|path| (path.as_str(), "base\n"))
        .collect();
    push_commit(temp_dir.path(), &repository.path, "main", &base_files);
    git(&repository.path, ["branch", "feature", "main"]);
    let main_files: Vec<(&str, &str)> = conflicting_paths
        .iter()
        .map(|path| (path.as_str(), "main\n"))
        .collect();
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &main_files,
        "main change",
    );
    let feature_files: Vec<(&str, &str)> = conflicting_paths
        .iter()
        .map(|path| (path.as_str(), "feature\n"))
        .collect();
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &feature_files,
        "feature change",
    );
    let base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();

    let mergeability = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert!(!mergeability.mergeable);
    assert_eq!(mergeability.conflict_paths.len(), 50);
    assert!(mergeability.conflict_paths_truncated);
    assert!(
        mergeability
            .conflict_paths
            .iter()
            .all(|path| conflicting_paths.contains(path))
    );
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "main"]).trim(),
        base_sha
    );
}

#[tokio::test]
async fn repository_mergeability_reports_unbounded_conflict_paths_below_the_limit() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n"), ("src/lib.rs", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n"), ("src/lib.rs", "main\n")],
        "main change",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("README.md", "feature\n"), ("src/lib.rs", "feature\n")],
        "feature change",
    );

    let mergeability = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert!(!mergeability.mergeable);
    assert_eq!(mergeability.conflict_paths, ["README.md", "src/lib.rs"]);
    assert!(!mergeability.conflict_paths_truncated);
}

#[tokio::test]
async fn repository_mergeability_rejects_missing_and_invalid_refs() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );

    let missing = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "missing")
        .await
        .unwrap_err();
    let invalid = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "../main", "main")
        .await
        .unwrap_err();
    let mismatched_storage_path = storage
        .check_repository_mergeability(REPOSITORY_ID, "/elsewhere.git", "main", "main")
        .await
        .unwrap_err();

    assert!(matches!(missing, RepositoryError::InvalidRepositoryRef));
    assert!(matches!(invalid, RepositoryError::InvalidRepositoryRef));
    assert!(matches!(
        mismatched_storage_path,
        RepositoryError::StoragePathMismatch
    ));
}

#[tokio::test]
async fn repository_mergeability_grpc_maps_refs_and_conflicts() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
        "main change",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("README.md", "feature\n")],
        "feature change",
    );
    let service = grpc_service(temp_dir.path());

    let conflicted = service
        .check_repository_mergeability(Request::new(CheckRepositoryMergeabilityRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path.clone(),
            base_ref: "main".to_string(),
            head_ref: "feature".to_string(),
        }))
        .await
        .unwrap()
        .into_inner();
    let missing_ref = service
        .check_repository_mergeability(Request::new(CheckRepositoryMergeabilityRequest {
            repository_id: REPOSITORY_ID.to_string(),
            storage_path: repository.storage_path,
            base_ref: "main".to_string(),
            head_ref: "missing".to_string(),
        }))
        .await
        .unwrap_err();

    assert!(!conflicted.mergeable);
    assert_eq!(conflicted.conflict_paths, ["README.md"]);
    assert!(!conflicted.conflict_paths_truncated);
    assert_eq!(conflicted.conflict_path_limit, 50);
    assert_eq!(missing_ref.code(), Code::InvalidArgument);
}

#[tokio::test]
async fn repository_mergeability_check_leaves_merge_and_cas_behavior_intact() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "feature commit",
    );
    let base_sha = git_stdout(&repository.path, ["rev-parse", "main"])
        .trim()
        .to_string();
    let head_sha = git_stdout(&repository.path, ["rev-parse", "feature"])
        .trim()
        .to_string();

    let mergeability = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();
    let stale = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &"0".repeat(40),
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap_err();
    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &mergeability.base_sha,
            &mergeability.head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap();

    assert!(mergeability.mergeable);
    assert_eq!(mergeability.base_sha, base_sha);
    assert_eq!(mergeability.head_sha, head_sha);
    assert!(matches!(stale, RepositoryError::StaleRepositoryRef));
    assert_eq!(
        git_stdout(&repository.path, ["rev-parse", "main"]).trim(),
        merged.resulting_sha
    );
    let parents = git_stdout(
        &repository.path,
        ["show", "-s", "--format=%P", &merged.resulting_sha],
    );
    assert_eq!(parents.split_whitespace().count(), 2);
    assert!(parents.contains(&base_sha));
    assert!(parents.contains(&head_sha));
}

#[tokio::test]
async fn repository_merge_squashes_the_merge_result_onto_one_parent() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");
    let merge_tree_sha = git_stdout(
        &repository.path,
        ["merge-tree", "--write-tree", &base_sha, &head_sha],
    )
    .trim()
    .to_string();

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Squash,
        ))
        .await
        .unwrap();

    assert_eq!(resolve(&repository.path, "main"), merged.resulting_sha);
    assert_eq!(
        commit_field(&repository.path, &merged.resulting_sha, "%P"),
        base_sha
    );
    // The squash commits the merge result, not the source tree, so work the
    // target picked up independently survives being squashed onto.
    assert_eq!(
        resolve(
            &repository.path,
            &format!("{}^{{tree}}", merged.resulting_sha)
        ),
        merge_tree_sha
    );
    assert_eq!(
        commit_field(&repository.path, &merged.resulting_sha, "%B"),
        format!(
            "Add the feature (#1)\n\nEverything the branch did, in one commit.\n\nTessera-Operation: {OPERATION_ID}"
        )
    );
    assert_eq!(
        commit_field(&repository.path, &merged.resulting_sha, "%an <%ae>"),
        "Ada <ada@example.com>"
    );

    // The source branch is gone and unreachable objects are collected, which is
    // exactly the state a merged pull request's comparison has to survive. Only
    // the receipt still reaches the tips it was merged from.
    git(&repository.path, ["update-ref", "-d", "refs/heads/feature"]);
    git(
        &repository.path,
        ["reflog", "expire", "--expire=now", "--all"],
    );
    git(&repository.path, ["gc", "--prune=now", "--quiet"]);

    // No branch reaches the merged head any more, so the receipt is the only
    // thing keeping it out of the pruner's way.
    assert!(
        !git_stdout(&repository.path, ["rev-list", "--branches"]).contains(&head_sha),
        "the source head should be unreachable from every branch"
    );
    let comparison = storage
        .compare_repository_refs(
            REPOSITORY_ID,
            &repository.storage_path,
            &base_sha,
            &head_sha,
        )
        .await
        .unwrap();

    assert_eq!(comparison.commits.len(), 2);
    assert!(
        comparison
            .files
            .iter()
            .any(|file| file.new_path == "feature.txt")
    );
}

#[tokio::test]
async fn repository_merge_rebases_preserving_authors_and_dropping_empty_commits() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    append_commit_as(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[],
        "empty feature commit",
        "Grace",
        "grace@example.com",
        "2026-05-16T13:00:00+00:00",
    );
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Rebase,
        ))
        .await
        .unwrap();

    assert_eq!(resolve(&repository.path, "main"), merged.resulting_sha);
    // A retry that lost the first response finds the receipt and reports the
    // commits it already produced rather than replaying them a second time.
    let retried = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Rebase,
        ))
        .await
        .unwrap();
    assert_eq!(retried, merged);
    let replayed = git_stdout(
        &repository.path,
        [
            "log",
            "--format=%H%x00%s%x00%an <%ae>%x00%aI%x00%cn <%ce>",
            &format!("{base_sha}..{}", merged.resulting_sha),
        ],
    );
    let replayed: Vec<Vec<String>> = replayed
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.split('\0').map(str::to_string).collect())
        .rev()
        .collect();

    // Three source commits went in and the empty one did not come out.
    assert_eq!(replayed.len(), 2);
    assert_eq!(replayed[0][1], "first feature commit");
    assert_eq!(replayed[0][2], "Grace <grace@example.com>");
    assert_eq!(replayed[0][3], "2026-05-16T11:00:00+00:00");
    assert_eq!(replayed[1][1], "second feature commit");
    assert_eq!(replayed[1][2], "Katherine <katherine@example.com>");
    // Whoever merged is the committer of every replayed commit, which is the
    // only part of them that is Tessera's to write.
    assert!(
        replayed
            .iter()
            .all(|commit| commit[4] == "Ada <ada@example.com>")
    );
    // A linear chain: the first replayed commit sits directly on the target.
    assert_eq!(
        commit_field(&repository.path, &replayed[0][0], "%P"),
        base_sha
    );
    assert_eq!(
        commit_field(&repository.path, &replayed[1][0], "%P"),
        replayed[0][0]
    );
    // Nothing Tessera writes appears on a commit that stayed the author's.
    assert!(
        !commit_field(&repository.path, &merged.resulting_sha, "%B").contains("Tessera-Operation")
    );

    git(&repository.path, ["update-ref", "-d", "refs/heads/feature"]);
    git(
        &repository.path,
        ["reflog", "expire", "--expire=now", "--all"],
    );
    git(&repository.path, ["gc", "--prune=now", "--quiet"]);

    // No branch reaches the merged head any more, so the receipt is the only
    // thing keeping it out of the pruner's way.
    assert!(
        !git_stdout(&repository.path, ["rev-list", "--branches"]).contains(&head_sha),
        "the source head should be unreachable from every branch"
    );
    let comparison = storage
        .compare_repository_refs(
            REPOSITORY_ID,
            &repository.storage_path,
            &base_sha,
            &head_sha,
        )
        .await
        .unwrap();

    assert_eq!(comparison.commits.len(), 3);
}

#[tokio::test]
async fn repository_merge_fast_forwards_onto_the_source_head() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "feature commit",
    );
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");
    let commit_count = git_stdout(&repository.path, ["rev-list", "--all", "--count"])
        .trim()
        .to_string();

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::FastForward,
        ))
        .await
        .unwrap();

    assert_eq!(merged.resulting_sha, head_sha);
    assert_eq!(resolve(&repository.path, "main"), head_sha);
    // No commit was authored: only the receipt was added to the object store.
    assert_eq!(
        git_stdout(&repository.path, ["rev-list", "--branches", "--count"]).trim(),
        commit_count
    );

    let retried = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::FastForward,
        ))
        .await
        .unwrap();

    assert_eq!(retried, merged);
}

#[tokio::test]
async fn repository_merge_refuses_strategies_this_history_cannot_run() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let not_fast_forward = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::FastForward,
        ))
        .await
        .unwrap_err();

    // Branches that already point at the same commit are up to date rather than
    // fast-forwardable: there is nowhere to advance to.
    git(
        &repository.path,
        ["update-ref", "refs/heads/feature", &base_sha],
    );
    let already_up_to_date = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &base_sha,
            RepositoryMergeStrategy::FastForward,
        ))
        .await
        .unwrap_err();

    assert!(matches!(
        not_fast_forward,
        RepositoryError::MergeStrategyUnavailable(
            RepositoryMergeStrategyUnavailableReason::NotFastForward
        )
    ));
    assert!(matches!(
        already_up_to_date,
        RepositoryError::MergeStrategyUnavailable(
            RepositoryMergeStrategyUnavailableReason::AlreadyUpToDate
        )
    ));
    assert_eq!(resolve(&repository.path, "main"), base_sha);
    // A refused strategy files no receipt, so nothing claims the target moved.
    assert!(!ref_exists(&repository.path, &operation_receipt_ref()));
}

// The ceiling is shared by the availability answer and the merge, so the two can
// never disagree about which histories are rebaseable. Both sides of it are
// checked here because an off-by-one would only ever show up as a merge method
// that is offered and then refused.
#[tokio::test]
async fn repository_merge_rebases_up_to_its_commit_limit_and_no_further() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("main.txt", "main\n")],
        "main commit",
    );
    append_source_commits(temp_dir.path(), &repository.path, 50);
    let base_sha = resolve(&repository.path, "main");

    let at_the_limit = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert_eq!(
        strategy_reason(&at_the_limit, RepositoryMergeStrategy::Rebase),
        Ok(())
    );

    // One more than the replay will take.
    append_source_commits(temp_dir.path(), &repository.path, 1);
    let head_sha = resolve(&repository.path, "feature");
    let past_the_limit = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();
    let refused = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Rebase,
        ))
        .await
        .unwrap_err();

    assert_eq!(
        strategy_reason(&past_the_limit, RepositoryMergeStrategy::Rebase),
        Err(RepositoryMergeStrategyUnavailableReason::UnsupportedHistory)
    );
    assert!(matches!(
        refused,
        RepositoryError::MergeStrategyUnavailable(
            RepositoryMergeStrategyUnavailableReason::UnsupportedHistory
        )
    ));
    assert_eq!(resolve(&repository.path, "main"), base_sha);
}

// A source branch that merged something into itself is flattened: the merge
// commits are dropped and the commits they brought in are replayed, which is
// what `git rebase` does by default.
#[tokio::test]
async fn repository_merge_rebases_a_source_branch_with_its_own_merges() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    git(&repository.path, ["branch", "side", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("main.txt", "main\n")],
        "main commit",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "feature commit",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "side",
        &[("side.txt", "side\n")],
        "side commit",
    );
    // A real merge commit inside the source branch's own history.
    let worktree = clone_branch(temp_dir.path(), &repository.path, "feature");
    command(worktree.path(), ["git", "fetch", "origin", "side"]);
    command(
        worktree.path(),
        ["git", "merge", "--no-ff", "-m", "merge side", "FETCH_HEAD"],
    );
    command(worktree.path(), ["git", "push", "origin", "feature"]);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Rebase,
        ))
        .await
        .unwrap();

    let replayed = git_stdout(
        &repository.path,
        [
            "log",
            "--format=%s%x00%P",
            &format!("{base_sha}..{}", merged.resulting_sha),
        ],
    );
    let rows: Vec<&str> = replayed.lines().filter(|line| !line.is_empty()).collect();

    // Both source commits arrive, the merge commit does not, and the chain is
    // linear: every replayed commit has exactly one parent.
    assert_eq!(rows.len(), 2);
    assert!(replayed.contains("feature commit"));
    assert!(replayed.contains("side commit"));
    assert!(!replayed.contains("merge side"));
    for row in rows {
        let parents = row.split('\0').nth(1).unwrap_or_default();
        assert_eq!(parents.split_whitespace().count(), 1);
    }
}

// A replay conflict is a conflict whatever the file is, and a rename on one side
// with an edit on the other is the case a three-way merge is most likely to get
// wrong quietly.
#[tokio::test]
async fn repository_merge_refuses_a_rebase_that_conflicts_on_binary_or_renamed_files() {
    for (name, target_files, source_files) in [
        (
            "binary",
            vec![("asset.bin", "\u{0}target\u{1}")],
            vec![("asset.bin", "\u{0}source\u{1}")],
        ),
        (
            "renamed",
            vec![("renamed.txt", "target\n")],
            vec![("original.txt", "source\n")],
        ),
    ] {
        let temp_dir = TempDir::new().unwrap();
        let storage = storage(temp_dir.path(), "git");
        let repository = storage.create_repository(&repository_id()).await.unwrap();
        push_commit(
            temp_dir.path(),
            &repository.path,
            "main",
            &[("original.txt", "base\n"), ("asset.bin", "\u{0}base\u{1}")],
        );
        git(&repository.path, ["branch", "feature", "main"]);

        if name == "renamed" {
            // The target renames the file the source then edits.
            let worktree = clone_branch(temp_dir.path(), &repository.path, "main");
            command(
                worktree.path(),
                ["git", "mv", "original.txt", "renamed.txt"],
            );
            command(worktree.path(), ["git", "commit", "-m", "rename"]);
            command(worktree.path(), ["git", "push", "origin", "main"]);
        } else {
            append_commit(
                temp_dir.path(),
                &repository.path,
                "main",
                &target_files,
                "target change",
            );
        }

        append_commit(
            temp_dir.path(),
            &repository.path,
            "feature",
            &source_files,
            "source change",
        );
        let base_sha = resolve(&repository.path, "main");
        let head_sha = resolve(&repository.path, "feature");

        let outcome = storage
            .merge_repository_refs(merge_request(
                &repository.storage_path,
                &base_sha,
                &head_sha,
                RepositoryMergeStrategy::Rebase,
            ))
            .await;

        // Either it replays cleanly or it refuses; what it must never do is move
        // the target while reporting a conflict, or lose the target's own work.
        if outcome.is_err() {
            assert!(
                matches!(outcome, Err(RepositoryError::MergeConflict)),
                "{name} should refuse with a conflict"
            );
            assert_eq!(resolve(&repository.path, "main"), base_sha, "{name}");
            assert!(!ref_exists(&repository.path, &operation_receipt_ref()));
        }
    }
}

#[tokio::test]
async fn repository_merge_refuses_a_rebase_that_replays_to_nothing() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit_as(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[],
        "empty feature commit",
        "Grace",
        "grace@example.com",
        "2026-05-16T11:00:00+00:00",
    );
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let error = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Rebase,
        ))
        .await
        .unwrap_err();

    assert!(matches!(
        error,
        RepositoryError::MergeStrategyUnavailable(
            RepositoryMergeStrategyUnavailableReason::NothingToRebase
        )
    ));
    assert_eq!(resolve(&repository.path, "main"), base_sha);
}

// A rebase builds every object before it touches a ref, so a replay that fails
// partway through leaves unreachable loose objects and nothing else.
#[tokio::test]
async fn repository_merge_leaves_the_target_untouched_when_a_replay_conflicts() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n"), ("shared.txt", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    // The first source commit replays cleanly; the second touches the same lines
    // the target moved, so only the second one conflicts.
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("feature.txt", "feature\n")],
        "clean feature commit",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("shared.txt", "feature\n")],
        "conflicting feature commit",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("shared.txt", "main\n")],
        "main change",
    );
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let error = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Rebase,
        ))
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::MergeConflict));
    assert_eq!(resolve(&repository.path, "main"), base_sha);
    assert_eq!(resolve(&repository.path, "feature"), head_sha);
    assert!(!ref_exists(&repository.path, &operation_receipt_ref()));
}

#[tokio::test]
async fn repository_merge_files_a_receipt_exactly_when_the_target_moves() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
        "main change",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("README.md", "feature\n")],
        "feature change",
    );
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let conflict = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Squash,
        ))
        .await
        .unwrap_err();

    assert!(matches!(conflict, RepositoryError::MergeConflict));
    assert_eq!(resolve(&repository.path, "main"), base_sha);
    assert!(!ref_exists(&repository.path, &operation_receipt_ref()));

    // Someone else moving the target to exactly where a fast-forward would have
    // left it is not this operation's merge: with no receipt of its own, the
    // only honest answer is that the world moved.
    git(
        &repository.path,
        ["update-ref", "refs/heads/main", &head_sha],
    );
    let stale = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::FastForward,
        ))
        .await
        .unwrap_err();

    assert!(matches!(stale, RepositoryError::StaleRepositoryRef));
}

#[tokio::test]
async fn repository_merge_receipt_records_the_tips_it_merged() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Squash,
        ))
        .await
        .unwrap();

    let receipt = commit_field(&repository.path, &operation_receipt_ref(), "%B");

    assert!(receipt.contains(&format!("Tessera-Operation: {OPERATION_ID}")));
    assert!(receipt.contains("Tessera-Strategy: squash"));
    assert!(receipt.contains(&format!("Tessera-Base: {base_sha}")));
    assert!(receipt.contains(&format!("Tessera-Head: {head_sha}")));
    assert!(receipt.contains(&format!("Tessera-Result: {}", merged.resulting_sha)));
    let parents = commit_field(&repository.path, &operation_receipt_ref(), "%P");
    assert!(parents.contains(&base_sha));
    assert!(parents.contains(&head_sha));
    assert!(parents.contains(&merged.resulting_sha));
}

#[tokio::test]
async fn repository_merge_strips_caller_authored_tessera_trailers() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");
    let mut request = merge_request(
        &repository.storage_path,
        &base_sha,
        &head_sha,
        RepositoryMergeStrategy::Squash,
    );
    request.squash_body = "Body\nTessera-Operation: 00000000-0000-0000-0000-000000000000";

    let merged = storage.merge_repository_refs(request).await.unwrap();

    let message = commit_field(&repository.path, &merged.resulting_sha, "%B");

    assert!(message.contains(&format!("Tessera-Operation: {OPERATION_ID}")));
    assert!(!message.contains("00000000-0000-0000-0000-000000000000"));
}

#[tokio::test]
async fn repository_merge_rejects_an_operation_id_that_is_not_a_uuid() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");
    let mut request = merge_request(
        &repository.storage_path,
        &base_sha,
        &head_sha,
        RepositoryMergeStrategy::MergeCommit,
    );
    request.operation_id = "../../heads/main";

    let error = storage.merge_repository_refs(request).await.unwrap_err();

    assert!(matches!(error, RepositoryError::InvalidMergeInput));
}

// Recording a merge after the fact is only safe for merges that happened. The
// lookup is what tells those apart, and it moves nothing either way.
// Merges made before receipts existed left only a trailer on the merge commit.
// That scan walks history, so it is reached only when the target has actually
// moved — a merge of ours that landed would have moved it, and a target sitting
// where this request expects it cannot be hiding one.
#[tokio::test]
async fn repository_merge_recovers_a_pre_receipt_merge_only_when_the_target_moved() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    // A merge exactly as the pre-receipt implementation left one: two parents,
    // the operation trailer, and no receipt anywhere.
    let tree_sha = git_stdout(
        &repository.path,
        ["merge-tree", "--write-tree", &base_sha, &head_sha],
    )
    .trim()
    .to_string();
    let legacy_merge_sha = git_stdout(
        &repository.path,
        [
            "commit-tree",
            &tree_sha,
            "-p",
            &base_sha,
            "-p",
            &head_sha,
            "-m",
            &format!("Merge pull request #1\n\nTessera-Operation: {OPERATION_ID}\n"),
        ],
    )
    .trim()
    .to_string();
    git(
        &repository.path,
        ["update-ref", "refs/heads/main", &legacy_merge_sha],
    );

    let recovered = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap();

    assert_eq!(recovered.resulting_sha, legacy_merge_sha);
    assert_eq!(resolve(&repository.path, "main"), legacy_merge_sha);
    assert!(!ref_exists(&repository.path, &operation_receipt_ref()));

    // With the target back where the request expects it there is nothing for the
    // scan to find, and the merge proceeds as an ordinary first attempt.
    git(
        &repository.path,
        ["update-ref", "refs/heads/main", &base_sha],
    );
    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::MergeCommit,
        ))
        .await
        .unwrap();

    assert_ne!(merged.resulting_sha, legacy_merge_sha);
    assert!(ref_exists(&repository.path, &operation_receipt_ref()));
}

#[tokio::test]
async fn repository_merge_receipt_lookup_finds_only_merges_that_happened() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let base_sha = resolve(&repository.path, "main");
    let head_sha = resolve(&repository.path, "feature");

    let before = storage
        .find_repository_merge_receipt(
            REPOSITORY_ID,
            &repository.storage_path,
            OPERATION_ID,
            RepositoryMergeStrategy::Squash,
            &base_sha,
            &head_sha,
        )
        .await
        .unwrap();

    assert_eq!(before, None);
    assert_eq!(resolve(&repository.path, "main"), base_sha);

    let merged = storage
        .merge_repository_refs(merge_request(
            &repository.storage_path,
            &base_sha,
            &head_sha,
            RepositoryMergeStrategy::Squash,
        ))
        .await
        .unwrap();

    assert_eq!(
        storage
            .find_repository_merge_receipt(
                REPOSITORY_ID,
                &repository.storage_path,
                OPERATION_ID,
                RepositoryMergeStrategy::Squash,
                &base_sha,
                &head_sha,
            )
            .await
            .unwrap(),
        Some(merged.resulting_sha)
    );

    // A receipt that records other tips, or another method, describes a merge
    // this caller never asked for.
    for (strategy, base, head) in [
        (RepositoryMergeStrategy::Rebase, &base_sha, &head_sha),
        (RepositoryMergeStrategy::Squash, &head_sha, &head_sha),
        (RepositoryMergeStrategy::Squash, &base_sha, &base_sha),
    ] {
        assert_eq!(
            storage
                .find_repository_merge_receipt(
                    REPOSITORY_ID,
                    &repository.storage_path,
                    OPERATION_ID,
                    strategy,
                    base,
                    head,
                )
                .await
                .unwrap(),
            None
        );
    }
}

// The paths that most need cleaning up are the ones that never reach the end of
// the function, so the scratch store is removed by its destructor rather than by
// a line at the bottom.
#[cfg(unix)]
#[tokio::test]
async fn repository_mergeability_removes_its_scratch_store_after_a_git_failure() {
    let temp_dir = TempDir::new().unwrap();
    let repository_storage = storage(temp_dir.path(), "git");
    let repository = repository_storage
        .create_repository(&repository_id())
        .await
        .unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    // Fails the first writing command the availability answer runs, which is
    // reached only after the scratch store has been created.
    let git_script = temp_dir.path().join("fail-merge-tree.sh");
    fs::write(
        &git_script,
        "#!/bin/sh\nfor argument in \"$@\"; do\n\tif [ \"$argument\" = \"merge-tree\" ]; then\n\t\tprintf 'forced merge-tree failure\\n' >&2\n\t\texit 3\n\tfi\ndone\nexec git \"$@\"\n",
    )
    .unwrap();
    make_executable(&git_script);
    let failing_storage = storage(temp_dir.path(), git_script.to_str().unwrap());

    let error = failing_storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap_err();

    assert!(matches!(error, RepositoryError::GitProcessFailed));
    assert_eq!(scratch_object_stores(&repository.path), 0);
}

// A cancelled answer has no executor left to await on, which is exactly why the
// cleanup is a destructor.
#[cfg(unix)]
#[tokio::test]
async fn repository_mergeability_removes_its_scratch_store_when_cancelled() {
    let temp_dir = TempDir::new().unwrap();
    let repository_storage = storage(temp_dir.path(), "git");
    let repository = repository_storage
        .create_repository(&repository_id())
        .await
        .unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    // Stalls the first command that runs after the scratch store is created, so
    // the cancellation lands while the store definitely exists.
    let git_script = temp_dir.path().join("slow-merge-tree.sh");
    fs::write(
        &git_script,
        "#!/bin/sh\nfor argument in \"$@\"; do\n\tif [ \"$argument\" = \"merge-tree\" ]; then\n\t\texec sleep 30\n\tfi\ndone\nexec git \"$@\"\n",
    )
    .unwrap();
    make_executable(&git_script);
    let slow_storage = storage(temp_dir.path(), git_script.to_str().unwrap());

    // Dropped mid-flight, the way the operation timeout drops it.
    let cancelled = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        slow_storage.check_repository_mergeability(
            REPOSITORY_ID,
            &repository.storage_path,
            "main",
            "feature",
        ),
    )
    .await;

    assert!(cancelled.is_err(), "the answer should have been cancelled");
    assert_eq!(scratch_object_stores(&repository.path), 0);
}

/// Scratch object stores the repository is still carrying.
fn scratch_object_stores(bare_repository_path: &Path) -> usize {
    fs::read_dir(bare_repository_path)
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("tessera-mergeability-")
        })
        .count()
}

// Deciding whether a rebase would go through means performing it, and every
// pull request page asks. Those objects go to a scratch store, not the
// repository the question is about.
#[tokio::test]
async fn repository_mergeability_writes_no_objects_into_the_repository() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);
    let objects_before = count_repository_objects(&repository.path);
    let entries_before = count_repository_entries(&repository.path);

    let mergeability = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert_eq!(
        strategy_reason(&mergeability, RepositoryMergeStrategy::Rebase),
        Ok(())
    );
    assert_eq!(
        count_repository_objects(&repository.path),
        objects_before,
        "an availability check must leave no objects in the repository"
    );
    // And the scratch store it used is gone with them.
    assert_eq!(count_repository_entries(&repository.path), entries_before);
}

/// Every object the repository's own store holds, loose or packed.
fn count_repository_objects(bare_repository_path: &Path) -> usize {
    git_stdout(
        bare_repository_path,
        ["cat-file", "--batch-all-objects", "--batch-check"],
    )
    .lines()
    .filter(|line| !line.is_empty())
    .count()
}

/// The repository directory's own entries, so a scratch store left behind is
/// visible even when it holds nothing.
fn count_repository_entries(bare_repository_path: &Path) -> usize {
    fs::read_dir(bare_repository_path).unwrap().count()
}

#[tokio::test]
async fn repository_mergeability_answers_for_every_strategy() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_diverged_feature_branch(temp_dir.path(), &repository.path);

    let diverged = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert_eq!(
        strategy_reason(&diverged, RepositoryMergeStrategy::MergeCommit),
        Ok(())
    );
    assert_eq!(
        strategy_reason(&diverged, RepositoryMergeStrategy::Squash),
        Ok(())
    );
    assert_eq!(
        strategy_reason(&diverged, RepositoryMergeStrategy::Rebase),
        Ok(())
    );
    assert_eq!(
        strategy_reason(&diverged, RepositoryMergeStrategy::FastForward),
        Err(RepositoryMergeStrategyUnavailableReason::NotFastForward)
    );

    // Rewinding the target under the same source makes it an ancestor again, and
    // only the fast-forward's answer changes.
    let merge_base_sha = git_stdout(&repository.path, ["merge-base", "main", "feature"])
        .trim()
        .to_string();
    git(
        &repository.path,
        ["update-ref", "refs/heads/main", &merge_base_sha],
    );
    let fast_forwardable = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert_eq!(
        strategy_reason(&fast_forwardable, RepositoryMergeStrategy::FastForward),
        Ok(())
    );
}

#[tokio::test]
async fn repository_mergeability_reports_a_conflict_against_every_combining_strategy() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    push_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "base\n")],
    );
    git(&repository.path, ["branch", "feature", "main"]);
    append_commit(
        temp_dir.path(),
        &repository.path,
        "main",
        &[("README.md", "main\n")],
        "main change",
    );
    append_commit(
        temp_dir.path(),
        &repository.path,
        "feature",
        &[("README.md", "feature\n")],
        "feature change",
    );

    let mergeability = storage
        .check_repository_mergeability(REPOSITORY_ID, &repository.storage_path, "main", "feature")
        .await
        .unwrap();

    assert!(!mergeability.mergeable);

    for strategy in [
        RepositoryMergeStrategy::MergeCommit,
        RepositoryMergeStrategy::Squash,
        RepositoryMergeStrategy::Rebase,
    ] {
        assert_eq!(
            strategy_reason(&mergeability, strategy),
            Err(RepositoryMergeStrategyUnavailableReason::Conflict),
            "{strategy:?} should be refused by the conflict"
        );
    }

    assert_eq!(
        strategy_reason(&mergeability, RepositoryMergeStrategy::FastForward),
        Err(RepositoryMergeStrategyUnavailableReason::NotFastForward)
    );
}

fn strategy_reason(
    mergeability: &RepositoryMergeability,
    strategy: RepositoryMergeStrategy,
) -> Result<(), RepositoryMergeStrategyUnavailableReason> {
    let availability = mergeability
        .strategy_availability
        .iter()
        .find(|availability| availability.strategy == strategy)
        .unwrap_or_else(|| panic!("{strategy:?} has no availability entry"));

    match availability.reason {
        Some(reason) => Err(reason),
        None => Ok(()),
    }
}

fn clone_branch<'a>(temp_root: &'a Path, bare_repository_path: &Path, branch: &str) -> TempDir {
    let worktree = TempDir::new_in(temp_root).unwrap();
    command(
        worktree.path(),
        [
            "git",
            "clone",
            "--branch",
            branch,
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
    worktree
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

fn merge_request<'a>(
    storage_path: &'a str,
    base_sha: &'a str,
    head_sha: &'a str,
    strategy: RepositoryMergeStrategy,
) -> RepositoryMergeRequest<'a> {
    RepositoryMergeRequest {
        repository_id: REPOSITORY_ID,
        storage_path,
        base_ref: "main",
        head_ref: "feature",
        expected_base_sha: base_sha,
        expected_head_sha: head_sha,
        author_name: "Ada",
        author_email: "ada@example.com",
        message: "Merge pull request #1",
        squash_title: "Add the feature (#1)",
        squash_body: "Everything the branch did, in one commit.",
        strategy,
        operation_id: OPERATION_ID,
    }
}

/// Stacks commits onto the source branch, for the cases that care about how
/// many there are rather than what is in them.
fn append_source_commits(temp_root: &Path, bare_repository_path: &Path, count: usize) {
    let worktree = clone_branch(temp_root, bare_repository_path, "feature");

    for index in 0..count {
        fs::write(
            worktree.path().join("stacked.txt"),
            format!("commit {index}\n"),
        )
        .unwrap();
        command(worktree.path(), ["git", "add", "."]);
        command(
            worktree.path(),
            ["git", "commit", "-m", &format!("stacked {index}")],
        );
    }

    command(worktree.path(), ["git", "push", "origin", "feature"]);
}

fn operation_receipt_ref() -> String {
    format!("refs/tessera/operations/{OPERATION_ID}")
}

fn ref_exists(bare_repository_path: &Path, reference: &str) -> bool {
    Command::new("git")
        .args([
            "--git-dir",
            bare_repository_path.to_str().unwrap(),
            "rev-parse",
            "--verify",
            "--quiet",
            reference,
        ])
        .output()
        .unwrap()
        .status
        .success()
}

fn resolve(bare_repository_path: &Path, revision: &str) -> String {
    git_stdout(bare_repository_path, ["rev-parse", revision])
        .trim()
        .to_string()
}

fn commit_field(bare_repository_path: &Path, revision: &str, format: &str) -> String {
    git_stdout(
        bare_repository_path,
        ["show", "-s", &format!("--format={format}"), revision],
    )
    .trim()
    .to_string()
}

/// A branch with three commits on top of `main`, of which the middle one changes
/// nothing that survives being replayed onto the target.
fn push_diverged_feature_branch(temp_root: &Path, bare_repository_path: &Path) {
    push_commit(
        temp_root,
        bare_repository_path,
        "main",
        &[("README.md", "base\n")],
    );
    git(bare_repository_path, ["branch", "feature", "main"]);
    append_commit(
        temp_root,
        bare_repository_path,
        "main",
        &[("main.txt", "main\n")],
        "main commit",
    );
    append_commit_as(
        temp_root,
        bare_repository_path,
        "feature",
        &[("feature.txt", "first\n")],
        "first feature commit",
        "Grace",
        "grace@example.com",
        "2026-05-16T11:00:00+00:00",
    );
    append_commit_as(
        temp_root,
        bare_repository_path,
        "feature",
        &[("feature.txt", "second\n")],
        "second feature commit",
        "Katherine",
        "katherine@example.com",
        "2026-05-16T12:00:00+00:00",
    );
}

fn grpc_service(storage_root: &Path) -> GitStorageGrpcService {
    GitStorageGrpcService::new(Config {
        host: "::".to_string(),
        port: 50051,
        http_host: "::".to_string(),
        http_port: 50052,
        ssh_host: "::".to_string(),
        ssh_port: 2222,
        ssh_host_key_path: storage_root.join("ssh_host_ed25519_key"),
        storage_root: storage_root.to_path_buf(),
        git_binary: PathBuf::from("git"),
        api_grpc_url: "http://localhost:50053".to_string(),
        api_grpc_authorization_token: Some("test-internal-token".to_string()),
        storage_grpc_authorization_token: "test-storage-token".to_string(),
    })
}

fn repository_id() -> RepositoryId {
    RepositoryId::parse(REPOSITORY_ID).unwrap()
}

fn create_bare_repository(path: &Path, initial_branch: &str) {
    command(
        path.parent().unwrap_or_else(|| Path::new(".")),
        [
            "git",
            "init",
            "--bare",
            "--initial-branch",
            initial_branch,
            path.to_str().unwrap(),
        ],
    );
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
    command(
        worktree.path(),
        ["git", "config", "commit.gpgsign", "false"],
    );
    command(worktree.path(), ["git", "config", "tag.gpgsign", "false"]);

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
    command(
        worktree.path(),
        ["git", "config", "commit.gpgsign", "false"],
    );
    command(worktree.path(), ["git", "config", "tag.gpgsign", "false"]);

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

#[allow(clippy::too_many_arguments)]
fn append_commit_as(
    temp_root: &Path,
    bare_repository_path: &Path,
    branch_name: &str,
    files: &[(&str, &str)],
    message: &str,
    author_name: &str,
    author_email: &str,
    author_date: &str,
) {
    let worktree = clone_branch(temp_root, bare_repository_path, branch_name);

    for (file_path, content) in files {
        let path = worktree.path().join(file_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    command(worktree.path(), ["git", "add", "."]);
    command_with_env(
        worktree.path(),
        ["git", "commit", "--allow-empty", "-m", message],
        &[
            ("GIT_AUTHOR_NAME", author_name),
            ("GIT_AUTHOR_EMAIL", author_email),
            ("GIT_AUTHOR_DATE", author_date),
            ("GIT_COMMITTER_DATE", "2026-05-16T10:05:00+00:00"),
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
            "--no-sign",
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

struct GeneratedGpgKey {
    home: TempDir,
    fingerprint: String,
    public_key: String,
}

impl GeneratedGpgKey {
    fn trusted_key(&self) -> TrustedGpgKey {
        TrustedGpgKey {
            key_id: self.fingerprint[self.fingerprint.len() - 16..].to_string(),
            fingerprint: self.fingerprint.clone(),
            public_key: self.public_key.clone(),
        }
    }
}

fn generate_gpg_key() -> Option<GeneratedGpgKey> {
    if Command::new("gpg").arg("--version").output().is_err() {
        return None;
    }

    let home = TempDir::new().unwrap();
    let home_path = home.path().to_str().unwrap();
    let output = Command::new("gpg")
        .args([
            "--homedir",
            home_path,
            "--batch",
            "--no-tty",
            "--pinentry-mode",
            "loopback",
            "--passphrase",
            "",
            "--quick-generate-key",
            "Tessera Signer <signer@example.com>",
            "ed25519",
            "sign",
            "1d",
        ])
        .output()
        .unwrap();

    if !output.status.success() {
        panic!(
            "failed to generate GPG key\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let public_key = gpg_stdout(home.path(), ["--armor", "--export", "signer@example.com"]);
    let secret_keys = gpg_stdout(home.path(), ["--with-colons", "--list-secret-keys"]);
    let fingerprint = secret_keys
        .lines()
        .find_map(|line| line.strip_prefix("fpr:::::::::"))
        .and_then(|line| line.split(':').next())
        .unwrap()
        .to_string();

    Some(GeneratedGpgKey {
        home,
        fingerprint,
        public_key,
    })
}

fn push_signed_commit_and_tag(
    temp_root: &Path,
    bare_repository_path: &Path,
    branch_name: &str,
    tag_name: &str,
    gpg_key: &GeneratedGpgKey,
) {
    let worktree = TempDir::new_in(temp_root).unwrap();
    command(
        worktree.path(),
        ["git", "init", "--initial-branch", branch_name],
    );
    command(
        worktree.path(),
        ["git", "config", "user.name", "GPG Signer"],
    );
    command(
        worktree.path(),
        ["git", "config", "user.email", "signer@example.com"],
    );
    command(
        worktree.path(),
        ["git", "config", "user.signingkey", &gpg_key.fingerprint],
    );
    command(worktree.path(), ["git", "config", "gpg.program", "gpg"]);
    fs::write(worktree.path().join("README.md"), "signed\n").unwrap();
    command(worktree.path(), ["git", "add", "."]);
    command_with_env(
        worktree.path(),
        ["git", "commit", "-S", "-m", "signed commit"],
        &[
            ("GNUPGHOME", gpg_key.home.path().to_str().unwrap()),
            ("GIT_AUTHOR_DATE", "2026-05-16T10:04:00+00:00"),
            ("GIT_COMMITTER_DATE", "2026-05-16T10:04:00+00:00"),
        ],
    );
    command_with_env(
        worktree.path(),
        ["git", "tag", "-s", tag_name, "-m", tag_name],
        &[
            ("GNUPGHOME", gpg_key.home.path().to_str().unwrap()),
            ("GIT_COMMITTER_DATE", "2026-05-16T10:05:00+00:00"),
        ],
    );
    command(
        worktree.path(),
        [
            "git",
            "push",
            bare_repository_path.to_str().unwrap(),
            &format!("HEAD:refs/heads/{branch_name}"),
            &format!("refs/tags/{tag_name}"),
        ],
    );
    git(
        bare_repository_path,
        ["symbolic-ref", "HEAD", &format!("refs/heads/{branch_name}")],
    );
}

fn gpg_stdout<const N: usize>(home: &Path, args: [&str; N]) -> String {
    let output = Command::new("gpg")
        .arg("--homedir")
        .arg(home)
        .args(args)
        .output()
        .unwrap();

    if !output.status.success() {
        panic!(
            "gpg command failed: {:?}\nstdout:\n{}\nstderr:\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    String::from_utf8(output.stdout).unwrap()
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
