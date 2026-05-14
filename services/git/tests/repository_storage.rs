use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use tempfile::TempDir;
use tessera_git::storage::infrastructure::RepositoryStorage;
use tessera_git::{RepositoryBlobPreview, RepositoryError, RepositoryId, RepositoryTreeEntryKind};

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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "")
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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main")
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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main")
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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main")
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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "develop")
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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "missing")
        .await
        .unwrap();

    assert_eq!(summary.default_branch, "main");
    assert_eq!(summary.readme.unwrap().content, b"main\n");
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
        .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, "main")
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
            .get_repository_browser_summary(REPOSITORY_ID, &repository.storage_path, branch_name)
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
        "/src",
        "src/",
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

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
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
    let worktree = TempDir::new_in(temp_root).unwrap();
    command(
        worktree.path(),
        ["git", "init", "--initial-branch", branch_name],
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
    command(worktree.path(), ["git", "commit", "-m", "test commit"]);
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

fn object_id_for_path(bare_repository_path: &Path, branch_name: &str, path: &str) -> String {
    let output = git_stdout(
        bare_repository_path,
        ["rev-parse", &format!("{branch_name}:{path}")],
    );

    output.trim().to_string()
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

fn command<const N: usize>(current_dir: &Path, args: [&str; N]) {
    command_vec(current_dir, args);
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
