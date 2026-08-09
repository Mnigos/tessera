use std::path::{Path, PathBuf};

use async_trait::async_trait;
use tempfile::TempDir;
use tessera_git::RepositoryId;
use tessera_git::domain::HIDDEN_REFS_CONFIG_ARGUMENT;
use tessera_git::ssh::{
    GitSshBackendRequest, SshAuthenticatedKey, SshGitApplication, SshGitAuthenticationRequest,
    SshGitAuthorizationRequest, SshGitAuthorizer, SshGitError, SshGitOperation,
    SshRepositoryMetadata, authorization_request, parse_ssh_git_command, spawn_git_ssh_process,
    ssh_exec_failure_message,
};
use tessera_git::storage::infrastructure::RepositoryStorage;

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";
const ACTOR_USER_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b6";

#[test]
fn ssh_command_parser_accepts_git_services() {
    let upload = parse_ssh_git_command("git-upload-pack mona/repo.git").unwrap();
    let receive = parse_ssh_git_command("git-receive-pack 'mona/repo.git'").unwrap();

    assert_eq!(upload.owner, "mona");
    assert_eq!(upload.repository, "repo");
    assert_eq!(upload.operation, SshGitOperation::UploadPack);
    assert_eq!(receive.operation, SshGitOperation::ReceivePack);
}

#[test]
fn ssh_command_parser_rejects_unsafe_or_unsupported_commands() {
    for input in [
        "git-upload-pack mona/repo",
        "git-upload-pack ../repo.git",
        "git-upload-pack mona/repo.git extra",
        "git-upload-archive mona/repo.git",
        "git-upload-pack 'mona/repo.git' extra",
    ] {
        assert!(parse_ssh_git_command(input).is_err(), "{input}");
    }
}

#[test]
fn ssh_exec_failure_messages_include_actionable_guidance() {
    let cases = [
        (
            SshGitError::InvalidCommand,
            "Invalid SSH Git command. Use git-upload-pack owner/repository.git or git-receive-pack owner/repository.git.",
        ),
        (
            SshGitError::UnsupportedService,
            "Unsupported SSH Git service. Only git-upload-pack and git-receive-pack are supported.",
        ),
        (
            SshGitError::InvalidRepositoryPath,
            "Invalid repository path. Use owner/repository.git without extra path segments.",
        ),
        (
            SshGitError::AuthorizationUnavailable,
            "Authorization service is unavailable. Try again later.",
        ),
        (
            SshGitError::Unauthorized,
            "Repository access denied. Confirm the repository exists and your SSH key has access.",
        ),
        (
            SshGitError::InvalidRepositoryMetadata,
            "Repository metadata is invalid. Contact support if this repository should be available.",
        ),
        (
            SshGitError::RepositoryUnavailable,
            "Repository storage is unavailable. Try again later.",
        ),
        (
            SshGitError::BackendFailed,
            "Git backend is unavailable. Try again later.",
        ),
    ];

    for (error, expected) in cases {
        assert_eq!(ssh_exec_failure_message(&error), expected);
    }
}

#[tokio::test]
async fn ssh_authorization_uses_fingerprint_repository_and_operation() {
    let command = parse_ssh_git_command("git-receive-pack mona/repo.git").unwrap();
    let request = authorization_request("git".to_string(), "SHA256:abc123".to_string(), command);

    assert_eq!(
        request,
        SshGitAuthorizationRequest {
            username: "git".to_string(),
            public_key_fingerprint: "SHA256:abc123".to_string(),
            owner: "mona".to_string(),
            repository: "repo".to_string(),
            operation: SshGitOperation::ReceivePack,
        }
    );
}

#[tokio::test]
async fn ssh_application_resolves_authorized_repository_through_storage_guard() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage
        .create_repository(&RepositoryId::parse(REPOSITORY_ID).unwrap())
        .await
        .unwrap();
    let application = SshGitApplication::new(
        FakeSshAuthorizer {
            repository_id: REPOSITORY_ID.to_string(),
            actor_user_id: Some(ACTOR_USER_ID.to_string()),
            storage_path: repository.storage_path,
        },
        storage,
    );

    let authorized = application
        .authorize(SshGitAuthorizationRequest {
            username: "git".to_string(),
            public_key_fingerprint: "SHA256:abc123".to_string(),
            owner: "mona".to_string(),
            repository: "repo".to_string(),
            operation: SshGitOperation::UploadPack,
        })
        .await
        .unwrap();

    assert_eq!(authorized.operation, SshGitOperation::UploadPack);
    assert_eq!(authorized.repository_id, REPOSITORY_ID);
    assert_eq!(
        authorized.actor_user_id,
        Some(ACTOR_USER_ID.to_string()),
        "the authorized user must survive authorization, never the SSH login"
    );
    assert_eq!(
        authorized.repository_path,
        temp_dir
            .path()
            .join("repositories")
            .join(format!("{REPOSITORY_ID}.git"))
    );
}

#[tokio::test]
async fn ssh_application_rejects_authorized_storage_path_mismatch() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    storage
        .create_repository(&RepositoryId::parse(REPOSITORY_ID).unwrap())
        .await
        .unwrap();
    let application = SshGitApplication::new(
        FakeSshAuthorizer {
            repository_id: REPOSITORY_ID.to_string(),
            actor_user_id: Some(ACTOR_USER_ID.to_string()),
            storage_path: temp_dir
                .path()
                .join("repositories")
                .join("different.git")
                .display()
                .to_string(),
        },
        storage,
    );

    let error = application
        .authorize(SshGitAuthorizationRequest {
            username: "git".to_string(),
            public_key_fingerprint: "SHA256:abc123".to_string(),
            owner: "mona".to_string(),
            repository: "repo".to_string(),
            operation: SshGitOperation::UploadPack,
        })
        .await
        .unwrap_err();

    assert_eq!(error, SshGitError::RepositoryUnavailable);
}

#[tokio::test]
async fn ssh_backend_hides_tessera_refs_from_both_advertisements() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    seed_repository_with_a_hidden_ref(&repository.path);

    for operation in [SshGitOperation::UploadPack, SshGitOperation::ReceivePack] {
        let child = spawn_git_ssh_process(
            PathBuf::from("git"),
            None,
            GitSshBackendRequest {
                operation,
                repository_path: repository.path.clone(),
                push_context: None,
            },
        )
        .unwrap();
        let advertisement = read_advertisement(child).await;

        assert!(
            contains(&advertisement, b"refs/heads/main"),
            "{operation:?} should still advertise the branch"
        );
        assert!(
            !contains(&advertisement, b"refs/tessera"),
            "{operation:?} must never advertise Tessera's own refs"
        );
    }
}

/// Both transports inject the same configuration, so this is the one place the
/// behaviour Tessera depends on is checked against Git itself: a push aimed at
/// the hidden namespace is refused, while an ordinary branch still goes through.
#[tokio::test]
async fn git_refuses_a_push_into_the_hidden_namespace() {
    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let repository = storage.create_repository(&repository_id()).await.unwrap();
    seed_repository_with_a_hidden_ref(&repository.path);
    let worktree = TempDir::new().unwrap();
    run(
        worktree.path(),
        &["git", "init", "--initial-branch", "main"],
    );
    run(worktree.path(), &["git", "config", "user.name", "Mona"]);
    run(
        worktree.path(),
        &["git", "config", "user.email", "mona@example.com"],
    );
    run(
        worktree.path(),
        &["git", "commit", "--allow-empty", "-m", "pushed"],
    );
    let receive_pack = format!("git -c {HIDDEN_REFS_CONFIG_ARGUMENT} receive-pack");
    let remote = repository.path.to_str().unwrap();

    let hidden = std::process::Command::new("git")
        .current_dir(worktree.path())
        .args([
            "push",
            "--receive-pack",
            &receive_pack,
            remote,
            "+HEAD:refs/tessera/operations/018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4c7",
        ])
        .output()
        .unwrap();
    let ordinary = std::process::Command::new("git")
        .current_dir(worktree.path())
        .args([
            "push",
            "--receive-pack",
            &receive_pack,
            remote,
            "+HEAD:refs/heads/pushed",
        ])
        .output()
        .unwrap();

    assert!(
        !hidden.status.success(),
        "a push into the hidden namespace must be refused"
    );
    assert!(
        ordinary.status.success(),
        "an ordinary branch push must still go through: {}",
        String::from_utf8_lossy(&ordinary.stderr)
    );
}

async fn read_advertisement(mut child: tokio::process::Child) -> Vec<u8> {
    use tokio::io::AsyncReadExt;

    let mut stdout = child.stdout.take().unwrap();
    let mut advertisement = vec![0_u8; 8192];
    let read_bytes = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        stdout.read(&mut advertisement),
    )
    .await
    .unwrap()
    .unwrap();
    advertisement.truncate(read_bytes);
    let _ = child.kill().await;

    advertisement
}

fn seed_repository_with_a_hidden_ref(bare_repository_path: &Path) {
    let worktree = TempDir::new().unwrap();
    run(
        worktree.path(),
        &["git", "init", "--initial-branch", "main"],
    );
    run(
        worktree.path(),
        &["git", "config", "user.name", "Tessera Test"],
    );
    run(
        worktree.path(),
        &["git", "config", "user.email", "test@example.com"],
    );
    run(
        worktree.path(),
        &["git", "commit", "--allow-empty", "-m", "base"],
    );
    run(
        worktree.path(),
        &[
            "git",
            "push",
            bare_repository_path.to_str().unwrap(),
            "HEAD:refs/heads/main",
        ],
    );
    run(
        Path::new("."),
        &[
            "git",
            "--git-dir",
            bare_repository_path.to_str().unwrap(),
            "update-ref",
            "refs/tessera/operations/018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4c7",
            "refs/heads/main",
        ],
    );
}

fn run(current_dir: &Path, args: &[&str]) {
    let output = std::process::Command::new(args[0])
        .current_dir(current_dir)
        .args(&args[1..])
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "command failed: {args:?}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

fn repository_id() -> RepositoryId {
    RepositoryId::parse(REPOSITORY_ID).unwrap()
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

#[derive(Clone)]
struct FakeSshAuthorizer {
    repository_id: String,
    actor_user_id: Option<String>,
    storage_path: String,
}

#[async_trait]
impl SshGitAuthorizer for FakeSshAuthorizer {
    async fn authenticate_public_key(
        &self,
        _request: SshGitAuthenticationRequest,
    ) -> Result<SshAuthenticatedKey, SshGitError> {
        Ok(SshAuthenticatedKey {
            trusted_user: "00000000-0000-4000-8000-000000000001".to_string(),
        })
    }

    async fn authorize(
        &self,
        _request: SshGitAuthorizationRequest,
    ) -> Result<SshRepositoryMetadata, SshGitError> {
        Ok(SshRepositoryMetadata {
            repository_id: self.repository_id.clone(),
            actor_user_id: self.actor_user_id.clone(),
            storage_path: self.storage_path.clone(),
        })
    }
}
