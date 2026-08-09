use std::fs::{self, FileTimes};
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime};

use tempfile::TempDir;
use tessera_git::proto::git_push_events_service_server::{
    GitPushEventsService, GitPushEventsServiceServer,
};
use tessera_git::proto::{NotifyPushRequest, NotifyPushResponse, PushRefUpdateKind};
use tessera_git::push_events::domain::{PushEventContext, PushHookConfig};
use tessera_git::push_events::infrastructure::{ApiPushEventNotifier, PushEventSpool};
use tessera_git::push_events::sweep_push_events;
use tessera_git::storage::infrastructure::RepositoryStorage;
use tessera_git::{RepositoryId, RepositoryMergeRequest, RepositoryMergeStrategy};
use tonic::transport::Server;
use tonic::{Request, Response, Status};

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";
const ACTOR_USER_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b6";
const NULL_SHA: &str = "0000000000000000000000000000000000000000";
const MISSING_SHA: &str = "1234567890123456789012345678901234567890";
/// Refused immediately, which is what leaves a push spooled for a later sweep.
const UNREACHABLE_API_URL: &str = "http://127.0.0.1:1";

#[tokio::test]
async fn hook_reports_a_fast_forward_as_a_head_update() {
    let repository = PushRepository::create();
    let context = push_context();

    let output = repository.run_hook(
        &context,
        &format!(
            "{} {} refs/heads/main\n",
            repository.first_commit, repository.second_commit
        ),
    );

    assert!(output.status.success());
    let request = repository.only_spooled_push().await;
    assert_eq!(request.operation_id, context.operation_id);
    assert_eq!(request.repository_id, REPOSITORY_ID);
    assert_eq!(request.actor_user_id, ACTOR_USER_ID);
    assert!(request.occurred_at_unix_ms > 0);
    let update = request.updates.first().unwrap();
    assert_eq!(update.ref_name, "refs/heads/main");
    assert_eq!(update.old_sha, repository.first_commit);
    assert_eq!(update.new_sha, repository.second_commit);
    assert_eq!(update.kind, PushRefUpdateKind::HeadUpdated as i32);
}

#[tokio::test]
async fn hook_reports_a_rewritten_branch_as_a_force_push() {
    let repository = PushRepository::create();

    let output = repository.run_hook(
        &push_context(),
        &format!(
            "{} {} refs/heads/main\n",
            repository.second_commit, repository.rewritten_commit
        ),
    );

    assert!(output.status.success());
    let request = repository.only_spooled_push().await;
    let update = request.updates.first().unwrap();
    assert_eq!(update.kind, PushRefUpdateKind::ForcePushed as i32);
}

#[tokio::test]
async fn hook_classifies_every_branch_of_one_push_independently() {
    let repository = PushRepository::create();

    let output = repository.run_hook(
        &push_context(),
        &format!(
            "{first} {second} refs/heads/main\n{second} {rewritten} refs/heads/rewrite\n",
            first = repository.first_commit,
            second = repository.second_commit,
            rewritten = repository.rewritten_commit
        ),
    );

    assert!(output.status.success());
    let request = repository.only_spooled_push().await;
    assert_eq!(
        request
            .updates
            .iter()
            .map(|update| (update.ref_name.as_str(), update.kind))
            .collect::<Vec<_>>(),
        vec![
            ("refs/heads/main", PushRefUpdateKind::HeadUpdated as i32),
            ("refs/heads/rewrite", PushRefUpdateKind::ForcePushed as i32),
        ]
    );
}

#[tokio::test]
async fn hook_reports_nothing_for_tags_creations_deletions_and_unchanged_branches() {
    let repository = PushRepository::create();

    let output = repository.run_hook(
        &push_context(),
        &format!(
            "{first} {second} refs/tags/v1\n{null} {second} refs/heads/created\n{second} {null} refs/heads/deleted\n{second} {second} refs/heads/unchanged\n",
            first = repository.first_commit,
            second = repository.second_commit,
            null = NULL_SHA
        ),
    );

    assert!(output.status.success());
    assert!(repository.spooled_pushes().await.is_empty());
}

#[tokio::test]
async fn hook_drops_updates_whose_ancestry_cannot_be_determined() {
    let repository = PushRepository::create();

    let output = repository.run_hook(
        &push_context(),
        &format!(
            "{MISSING_SHA} {} refs/heads/main\n",
            repository.second_commit
        ),
    );

    assert!(
        output.status.success(),
        "a push whose refs are already committed must never look failed"
    );
    assert!(
        repository.spooled_pushes().await.is_empty(),
        "an unanswerable ancestry check must not be reported as a force push"
    );
}

#[tokio::test]
async fn hook_succeeds_without_push_context() {
    let repository = PushRepository::create();

    let output = repository.run_hook_with_environment(
        &[],
        &format!(
            "{} {} refs/heads/main\n",
            repository.first_commit, repository.second_commit
        ),
    );

    assert!(output.status.success());
    assert!(repository.spooled_pushes().await.is_empty());
}

#[tokio::test]
async fn hook_drops_a_branch_whose_ancestry_check_outruns_its_budget_and_kills_it() {
    let repository = PushRepository::create();
    let slow_git = repository.install_slow_git();
    let started_at = Instant::now();

    let output = repository.run_hook_with_environment(
        &repository
            .hook_config_with_git(&slow_git.path)
            .environment(&push_context()),
        &format!(
            "{} {} refs/heads/main\n",
            repository.first_commit, repository.second_commit
        ),
    );

    assert!(output.status.success());
    assert!(
        started_at.elapsed() < Duration::from_secs(15),
        "the hook must give up long before the transport does"
    );
    assert!(repository.spooled_pushes().await.is_empty());
    assert!(
        !slow_git.is_running(),
        "an ancestry check that outran its budget must not outlive the hook"
    );
}

#[tokio::test]
async fn hook_succeeds_when_the_spool_cannot_be_written() {
    let repository = PushRepository::create();
    let spool_path = repository.hook_config().spool_path();
    fs::create_dir_all(&spool_path).unwrap();
    fs::set_permissions(&spool_path, fs::Permissions::from_mode(0o500)).unwrap();

    let output = repository.run_hook(
        &push_context(),
        &format!(
            "{} {} refs/heads/main\n",
            repository.first_commit, repository.second_commit
        ),
    );

    fs::set_permissions(&spool_path, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        output.status.success(),
        "a push whose refs are already committed must never look failed"
    );
    assert!(
        output.stderr.is_empty(),
        "the client must not see hook output"
    );
    assert!(repository.spooled_pushes().await.is_empty());
}

#[tokio::test]
async fn hook_writes_its_diagnostics_to_its_own_log_rather_than_to_the_client() {
    let repository = PushRepository::create();

    let output = repository.run_hook(
        &push_context(),
        &format!(
            "{MISSING_SHA} {} refs/heads/main\n",
            repository.second_commit
        ),
    );

    assert!(output.status.success());
    assert!(
        output.stderr.is_empty(),
        "the client must not see hook output"
    );
    let log = fs::read_to_string(repository.hook_config().spool_path().join("hook.log")).unwrap();
    assert!(
        log.contains("ancestry could not be determined"),
        "the operator must see what the client does not: {log}"
    );
}

#[tokio::test]
async fn sweeper_delivers_a_push_the_api_refused_earlier() {
    let repository = PushRepository::create();
    let spool = repository.spool();
    spool.store(&notification("recovered")).await.unwrap();
    let api = FakePushEventsApi::reserve();
    let notifier = ApiPushEventNotifier::new(&api.url, Some("service-token"));

    sweep_push_events(&spool, &notifier).await;
    assert_eq!(
        spool.pending().await.unwrap().len(),
        1,
        "an unreachable API leaves the push for the next sweep"
    );

    let api = api.serve().await;
    sweep_push_events(&spool, &notifier).await;

    assert!(spool.pending().await.unwrap().is_empty());
    assert_eq!(api.received(), vec![notification("recovered")]);
}

#[tokio::test]
async fn sweeper_recovers_a_push_that_was_never_handed_over() {
    let repository = PushRepository::create();
    let spool = repository.spool();
    let spooled = spool.store(&notification("unhanded")).await.unwrap();
    let unhanded = spooled.with_extension("pending");
    fs::rename(&spooled, &unhanded).unwrap();
    let fresh = spool.store(&notification("in-flight")).await.unwrap();
    let in_flight = fresh.with_extension("pending");
    fs::rename(&fresh, &in_flight).unwrap();
    backdate(&unhanded, Duration::from_secs(120));

    sweep_push_events(&spool, &unreachable_notifier()).await;

    assert_eq!(spool.pending().await.unwrap(), vec![spooled]);
    assert!(
        in_flight.exists(),
        "a delivery a running hook may still be writing must be left alone"
    );
}

#[tokio::test]
async fn sweeper_keeps_a_push_the_api_never_acknowledged() {
    let repository = PushRepository::create();
    repository.run_hook(
        &push_context(),
        &format!(
            "{} {} refs/heads/main\n",
            repository.first_commit, repository.second_commit
        ),
    );
    let spool = repository.spool();
    let spooled = spool.pending().await.unwrap();

    sweep_push_events(&spool, &unreachable_notifier()).await;

    assert_eq!(spool.pending().await.unwrap(), spooled);
}

#[tokio::test]
async fn sweeper_sets_unreadable_deliveries_aside() {
    let repository = PushRepository::create();
    let spool = repository.spool();
    let corrupted = repository.hook_config().spool_path().join("corrupted.push");
    fs::create_dir_all(corrupted.parent().unwrap()).unwrap();
    fs::write(&corrupted, b"not a protobuf message").unwrap();

    sweep_push_events(&spool, &unreachable_notifier()).await;

    assert!(spool.pending().await.unwrap().is_empty());
    assert!(corrupted.with_extension("invalid").exists());
}

#[tokio::test]
async fn imports_fetches_merges_and_mirror_pushes_never_reach_the_hook() {
    let repository = PushRepository::create();
    let storage_path = repository.repository_path.display().to_string();
    let mirror_path = repository.repository_path.with_file_name("mirror.git");
    git_init_bare(&mirror_path);

    repository
        .storage()
        .merge_repository_refs(RepositoryMergeRequest {
            repository_id: REPOSITORY_ID,
            storage_path: &storage_path,
            base_ref: "main",
            head_ref: "rewrite",
            expected_base_sha: &repository.second_commit,
            expected_head_sha: &repository.rewritten_commit,
            author_name: "Tessera Test",
            author_email: "test@example.com",
            message: "Merge rewrite",
            squash_title: "",
            squash_body: "",
            strategy: RepositoryMergeStrategy::MergeCommit,
            operation_id: "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4c7",
        })
        .await
        .unwrap();
    // The repository already exists, so this is the refresh-fetch path rather
    // than the initial clone.
    repository
        .storage()
        .import_repository(
            &RepositoryId::parse(REPOSITORY_ID).unwrap(),
            &storage_path,
            repository.source_repository_path.to_str().unwrap(),
            None,
            "main",
        )
        .await
        .unwrap();
    repository
        .storage()
        .push_repository_mirror(
            &RepositoryId::parse(REPOSITORY_ID).unwrap(),
            &storage_path,
            mirror_path.to_str().unwrap(),
            None,
        )
        .await
        .unwrap();

    assert!(
        repository.spooled_pushes().await.is_empty(),
        "only receive-pack runs the hook, and none of these does"
    );
    assert!(
        !repository
            .repository_path
            .join("hooks/post-receive")
            .exists(),
        "the hook is central, so no repository carries one of its own"
    );
}

fn unreachable_notifier() -> ApiPushEventNotifier {
    ApiPushEventNotifier::new(UNREACHABLE_API_URL, Some("service-token"))
}

fn push_context() -> PushEventContext {
    PushEventContext::new(REPOSITORY_ID.to_string(), ACTOR_USER_ID.to_string())
}

fn notification(operation_id: &str) -> NotifyPushRequest {
    NotifyPushRequest {
        operation_id: operation_id.to_string(),
        repository_id: REPOSITORY_ID.to_string(),
        actor_user_id: ACTOR_USER_ID.to_string(),
        occurred_at_unix_ms: 1_700_000_000_000,
        updates: Vec::new(),
    }
}

fn backdate(path: &Path, age: Duration) {
    let times = FileTimes::new().set_modified(SystemTime::now() - age);
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(times)
        .unwrap();
}

/// A `git` that never answers, so the ancestry check has to give up on it.
struct SlowGit {
    path: PathBuf,
    pid_path: PathBuf,
}

impl SlowGit {
    fn is_running(&self) -> bool {
        let pid = fs::read_to_string(&self.pid_path).unwrap();

        Command::new("kill")
            .args(["-0", pid.trim()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    }
}

/// Stands in for the API, and can be reserved before it listens so a sweep can
/// be made to fail and then succeed against the same address.
struct FakePushEventsApi {
    url: String,
    address: std::net::SocketAddr,
    received: Arc<Mutex<Vec<NotifyPushRequest>>>,
}

impl FakePushEventsApi {
    fn reserve() -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);

        Self {
            url: format!("http://{address}"),
            address,
            received: Arc::new(Mutex::new(Vec::new())),
        }
    }

    async fn serve(self) -> Self {
        let service = FakePushEventsService {
            received: Arc::clone(&self.received),
        };
        let address = self.address;
        tokio::spawn(async move {
            Server::builder()
                .add_service(GitPushEventsServiceServer::new(service))
                .serve(address)
                .await
        });

        for _ in 0..100 {
            if std::net::TcpStream::connect(address).is_ok() {
                break;
            }

            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        self
    }

    fn received(&self) -> Vec<NotifyPushRequest> {
        self.received.lock().unwrap().clone()
    }
}

struct FakePushEventsService {
    received: Arc<Mutex<Vec<NotifyPushRequest>>>,
}

#[tonic::async_trait]
impl GitPushEventsService for FakePushEventsService {
    async fn notify_push(
        &self,
        request: Request<NotifyPushRequest>,
    ) -> Result<Response<NotifyPushResponse>, Status> {
        self.received.lock().unwrap().push(request.into_inner());

        Ok(Response::new(NotifyPushResponse {}))
    }
}

/// A bare repository under a storage root, holding a branch that moved forward
/// and a branch that was rewritten, so both classifications can be asked of
/// real Git objects.
struct PushRepository {
    _temp_dir: TempDir,
    storage_root: PathBuf,
    repository_path: PathBuf,
    source_repository_path: PathBuf,
    first_commit: String,
    second_commit: String,
    rewritten_commit: String,
}

impl PushRepository {
    fn create() -> Self {
        let temp_dir = TempDir::new().unwrap();
        let storage_root = temp_dir.path().join("storage");
        let repository_path = storage_root
            .join("repositories")
            .join(format!("{REPOSITORY_ID}.git"));
        let worktree = temp_dir.path().join("worktree");

        git_init_bare(&repository_path);
        fs::create_dir_all(&worktree).unwrap();
        git(&worktree, ["init", "--initial-branch", "main"]);
        git(&worktree, ["config", "user.name", "Tessera Test"]);
        git(&worktree, ["config", "user.email", "test@example.com"]);
        git(&worktree, ["config", "commit.gpgsign", "false"]);

        commit(&worktree, "README.md", "# Tessera\n");
        let first_commit = rev_parse(&worktree, "HEAD");
        commit(&worktree, "second.txt", "second\n");
        let second_commit = rev_parse(&worktree, "HEAD");
        git(&worktree, ["reset", "--hard", &first_commit]);
        commit(&worktree, "rewritten.txt", "rewritten\n");
        let rewritten_commit = rev_parse(&worktree, "HEAD");

        let remote = repository_path.to_str().unwrap();
        git(
            &worktree,
            ["push", remote, &format!("{second_commit}:refs/heads/main")],
        );
        git(
            &worktree,
            [
                "push",
                remote,
                &format!("{rewritten_commit}:refs/heads/rewrite"),
            ],
        );

        Self {
            _temp_dir: temp_dir,
            storage_root,
            repository_path,
            source_repository_path: worktree,
            first_commit,
            second_commit,
            rewritten_commit,
        }
    }

    fn storage(&self) -> RepositoryStorage {
        RepositoryStorage::new(self.storage_root.clone(), PathBuf::from("git"))
    }

    fn hook_config(&self) -> PushHookConfig {
        self.hook_config_with_git(Path::new("git"))
    }

    fn hook_config_with_git(&self, git_binary: &Path) -> PushHookConfig {
        PushHookConfig::new(
            self.storage_root.clone(),
            git_binary.to_path_buf(),
            UNREACHABLE_API_URL.to_string(),
            Some("service-token".to_string()),
        )
    }

    fn install_slow_git(&self) -> SlowGit {
        let path = self.storage_root.join("slow-git");
        let pid_path = self.storage_root.join("slow-git.pid");
        fs::create_dir_all(&self.storage_root).unwrap();
        fs::write(
            &path,
            // exec makes sleep replace the shell, so the recorded pid is the
            // long-running process itself and the kill assertion covers it.
            format!(
                "#!/bin/sh\necho $$ > '{}'\nexec sleep 30\n",
                pid_path.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        SlowGit { path, pid_path }
    }

    fn spool(&self) -> PushEventSpool {
        PushEventSpool::new(self.hook_config().spool_path())
    }

    async fn spooled_pushes(&self) -> Vec<NotifyPushRequest> {
        let spool = self.spool();
        let mut requests = Vec::new();

        for path in spool.pending().await.unwrap() {
            requests.push(spool.load(&path).await.unwrap());
        }

        requests
    }

    async fn only_spooled_push(&self) -> NotifyPushRequest {
        let mut pushes = self.spooled_pushes().await;

        assert_eq!(pushes.len(), 1);

        pushes.remove(0)
    }

    /// Runs the service binary the way the installed hook does, with exactly
    /// the environment both transports inject.
    fn run_hook(&self, context: &PushEventContext, input: &str) -> std::process::Output {
        self.run_hook_with_environment(&self.hook_config().environment(context), input)
    }

    fn run_hook_with_environment(
        &self,
        environment: &[(String, String)],
        input: &str,
    ) -> std::process::Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_tessera-git"))
            .arg("post-receive-hook")
            .env_clear()
            .env("PATH", std::env::var("PATH").unwrap_or_default())
            .envs(environment.iter().map(|(name, value)| (name, value)))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();

        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();

        child.wait_with_output().unwrap()
    }
}

fn git_init_bare(repository_path: &Path) {
    fs::create_dir_all(repository_path.parent().unwrap()).unwrap();
    git(
        repository_path.parent().unwrap(),
        [
            "init",
            "--bare",
            "--initial-branch",
            "main",
            repository_path.to_str().unwrap(),
        ],
    );
}

fn commit(worktree: &Path, file_name: &str, content: &str) {
    fs::write(worktree.join(file_name), content).unwrap();
    git(worktree, ["add", "."]);
    git(worktree, ["commit", "-m", &format!("Add {file_name}")]);
}

fn rev_parse(worktree: &Path, revision: &str) -> String {
    let output = Command::new("git")
        .current_dir(worktree)
        .args(["rev-parse", revision])
        .output()
        .unwrap();

    assert!(output.status.success());

    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

fn git<const N: usize>(current_dir: &Path, args: [&str; N]) {
    let output = Command::new("git")
        .current_dir(current_dir)
        .args(args)
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "git failed: {:?}\nstdout:\n{}\nstderr:\n{}",
        args,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
