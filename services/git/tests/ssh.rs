use std::path::{Path, PathBuf};

use async_trait::async_trait;
use tempfile::TempDir;
use tessera_git::RepositoryId;
use tessera_git::ssh::{
    SshAuthenticatedKey, SshGitApplication, SshGitAuthenticationRequest,
    SshGitAuthorizationRequest, SshGitAuthorizer, SshGitError, SshGitOperation,
    SshRepositoryMetadata, authorization_request, parse_ssh_git_command, ssh_exec_failure_message,
};
use tessera_git::storage::infrastructure::RepositoryStorage;

const REPOSITORY_ID: &str = "018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4b5";

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
async fn ssh_server_rejects_connections_beyond_the_concurrency_limit() {
    use std::time::Duration;

    use tessera_git::ssh::infrastructure::SshServerLimits;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpStream;

    let (addr, _guard) = spawn_ssh_server(SshServerLimits {
        max_connections: 1,
        handshake_timeout: Duration::from_secs(5),
    })
    .await;

    // The first connection acquires the only permit and receives the SSH banner.
    let mut first = TcpStream::connect(addr).await.unwrap();
    let mut banner = [0_u8; 4];
    first.read_exact(&mut banner).await.unwrap();
    assert_eq!(
        &banner, b"SSH-",
        "accepted connection should receive the banner"
    );

    // The second connection is over the limit and is closed without a banner.
    let mut second = TcpStream::connect(addr).await.unwrap();
    let mut buffer = [0_u8; 1];
    let read = tokio::time::timeout(Duration::from_secs(2), second.read(&mut buffer))
        .await
        .expect("rejected connection should close promptly")
        .unwrap();
    assert_eq!(
        read, 0,
        "over-limit connection should be closed immediately"
    );

    // Freeing the permit lets a subsequent client through again.
    drop(first);
    let mut third = TcpStream::connect(addr).await.unwrap();
    let mut banner = [0_u8; 4];
    tokio::time::timeout(Duration::from_secs(2), third.read_exact(&mut banner))
        .await
        .expect("permit should be released")
        .unwrap();
    assert_eq!(&banner, b"SSH-");
}

#[tokio::test]
async fn ssh_server_times_out_stalled_handshakes() {
    use std::time::Duration;

    use tessera_git::ssh::infrastructure::SshServerLimits;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpStream;

    let (addr, _guard) = spawn_ssh_server(SshServerLimits {
        max_connections: 8,
        handshake_timeout: Duration::from_millis(300),
    })
    .await;

    // Connect but never send our SSH identification string.
    let mut client = TcpStream::connect(addr).await.unwrap();
    let mut banner = vec![0_u8; 256];
    let read = client.read(&mut banner).await.unwrap();
    assert!(read > 0, "server should send its banner before timing out");

    // With no client id sent, the server aborts the handshake and closes the socket.
    let mut tail = vec![0_u8; 256];
    let read = tokio::time::timeout(Duration::from_secs(2), client.read(&mut tail))
        .await
        .expect("stalled handshake should be closed within the timeout")
        .unwrap();
    assert_eq!(read, 0, "stalled handshake should be closed by the server");
}

#[tokio::test]
async fn ssh_server_survives_malformed_pre_authentication_traffic() {
    use std::time::Duration;

    use tessera_git::ssh::infrastructure::SshServerLimits;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let (addr, _guard) = spawn_ssh_server(SshServerLimits {
        max_connections: 8,
        handshake_timeout: Duration::from_secs(5),
    })
    .await;

    // Send a plausible client identification string followed by a binary packet
    // that declares an enormous length. A vulnerable server (see GHSA-4r3c-5hpg-58qr)
    // would allocate or parse the oversized frame before authentication; the pinned
    // russh must reject the malformed handshake and close the socket instead.
    let mut attacker = TcpStream::connect(addr).await.unwrap();
    let mut banner = [0_u8; 4];
    attacker.read_exact(&mut banner).await.unwrap();
    assert_eq!(&banner, b"SSH-", "server should send its banner first");

    attacker
        .write_all(b"SSH-2.0-tessera-malformed\r\n")
        .await
        .unwrap();
    // A packet length prefix of 0xFFFFFFFF with no matching payload.
    attacker
        .write_all(&[0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00])
        .await
        .unwrap();

    // The server drains and rejects the connection instead of hanging or aborting.
    // We tolerate whatever banner/KEXINIT bytes are buffered and only require the
    // socket to reach EOF within the handshake window.
    tokio::time::timeout(Duration::from_secs(5), async {
        let mut sink = vec![0_u8; 1024];
        loop {
            match attacker.read(&mut sink).await {
                Ok(0) => break,
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    })
    .await
    .expect("malformed handshake should be closed, not left hanging");

    // Critically, the accept loop survives the malformed peer: a fresh client
    // still receives a banner, proving the server did not crash or wedge.
    let mut healthy = TcpStream::connect(addr).await.unwrap();
    let mut banner = [0_u8; 4];
    tokio::time::timeout(Duration::from_secs(2), healthy.read_exact(&mut banner))
        .await
        .expect("server should remain responsive after malformed input")
        .unwrap();
    assert_eq!(&banner, b"SSH-");
}

#[tokio::test]
async fn ssh_server_completes_channel_open_and_close_lifecycle() {
    use std::time::Duration;

    use tessera_git::ssh::infrastructure::SshServerLimits;

    let (addr, _guard) = spawn_ssh_server(SshServerLimits {
        max_connections: 8,
        handshake_timeout: Duration::from_secs(10),
    })
    .await;

    let handle = connect_authenticated_client(addr).await;

    // The ported `channel_open_session` handler must accept the channel; this
    // client call only resolves once the server confirms the open, so a
    // successful return regresses the russh 0.62 breaking change.
    let mut channel = handle
        .channel_open_session()
        .await
        .expect("server should confirm the session channel");

    // Closing the channel drives the close handshake to completion without error.
    channel.close().await.expect("channel close should succeed");

    // Draining to `None` proves the channel reaches a fully closed state rather
    // than leaking on the server side.
    tokio::time::timeout(Duration::from_secs(5), async {
        while channel.wait().await.is_some() {}
    })
    .await
    .expect("channel should reach a closed state");
}

#[tokio::test]
async fn ssh_server_reclaims_admission_after_a_session_completes() {
    use std::time::Duration;

    use tessera_git::ssh::infrastructure::SshServerLimits;
    use tokio::io::AsyncReadExt;
    use tokio::net::TcpStream;

    let (addr, _guard) = spawn_ssh_server(SshServerLimits {
        max_connections: 1,
        handshake_timeout: Duration::from_secs(10),
    })
    .await;

    // A fully authenticated session with an open channel holds the only admission
    // permit for the lifetime of the connection.
    let session = connect_authenticated_client(addr).await;
    let _channel = session
        .channel_open_session()
        .await
        .expect("first session should open a channel");

    // While the permit is held, a new connection is admission-denied: the server
    // closes it before sending any banner.
    let mut denied = TcpStream::connect(addr).await.unwrap();
    let mut buffer = [0_u8; 1];
    let read = tokio::time::timeout(Duration::from_secs(2), denied.read(&mut buffer))
        .await
        .expect("over-limit connection should close promptly")
        .unwrap();
    assert_eq!(
        read, 0,
        "admission control should reject the over-limit connection"
    );

    // Ending the session releases the permit back to the semaphore.
    drop(_channel);
    drop(session);

    // A subsequent client is then readmitted and can authenticate again. Permit
    // release is observed once the server-side session future resolves, so poll
    // briefly to avoid racing that teardown.
    let readmitted = poll_authenticated_client(addr).await;
    readmitted
        .channel_open_session()
        .await
        .expect("readmitted session should open a channel");
}

/// Establishes a connection, completes public-key authentication (accepted by
/// [`FakeSshAuthorizer`]), and returns the live client handle.
async fn connect_authenticated_client(
    addr: std::net::SocketAddr,
) -> russh::client::Handle<AcceptingSshClient> {
    try_authenticated_client(addr)
        .await
        .expect("client should authenticate against the SSH server")
}

/// Polls until the server readmits a client after an admission permit is freed.
async fn poll_authenticated_client(
    addr: std::net::SocketAddr,
) -> russh::client::Handle<AcceptingSshClient> {
    use std::time::Duration;

    for _ in 0..50 {
        if let Ok(handle) = try_authenticated_client(addr).await {
            return handle;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    panic!("server never readmitted a client after the permit was released");
}

async fn try_authenticated_client(
    addr: std::net::SocketAddr,
) -> Result<russh::client::Handle<AcceptingSshClient>, russh::Error> {
    use std::sync::Arc;

    let config = Arc::new(russh::client::Config::default());
    let mut handle = russh::client::connect(config, addr, AcceptingSshClient).await?;

    let key = russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519)
        .map_err(|_| russh::Error::CouldNotReadKey)?;
    let authenticated = handle
        .authenticate_publickey(
            "git",
            russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key), None),
        )
        .await?;

    if !authenticated.success() {
        return Err(russh::Error::NotAuthenticated);
    }

    Ok(handle)
}

/// Minimal SSH client handler that trusts the ephemeral test host key so the
/// integration tests can drive real handshakes against the server.
struct AcceptingSshClient;

impl russh::client::Handler for AcceptingSshClient {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

async fn spawn_ssh_server(
    limits: tessera_git::ssh::infrastructure::SshServerLimits,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>) {
    use std::sync::Arc;

    use tessera_git::ssh::infrastructure::{SshGitServer, run_ssh_server};
    use tokio::net::TcpListener;

    let temp_dir = TempDir::new().unwrap();
    let storage = storage(temp_dir.path(), "git");
    let application = SshGitApplication::new(
        FakeSshAuthorizer {
            repository_id: String::new(),
            storage_path: String::new(),
        },
        storage,
    );
    let server = SshGitServer::new(application, PathBuf::from("git"));

    let host_key =
        russh::keys::PrivateKey::random(&mut rand::rng(), russh::keys::Algorithm::Ed25519).unwrap();
    let config = Arc::new(russh::server::Config {
        keys: vec![host_key],
        ..Default::default()
    });

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let handle = tokio::spawn(async move {
        // Hold the temp dir for the lifetime of the server task.
        let _temp_dir = temp_dir;
        let _ = run_ssh_server(listener, config, server, limits).await;
    });

    (addr, handle)
}

fn storage(storage_root: &Path, git_binary: &str) -> RepositoryStorage {
    RepositoryStorage::new(storage_root.to_path_buf(), PathBuf::from(git_binary))
}

#[derive(Clone)]
struct FakeSshAuthorizer {
    repository_id: String,
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
            storage_path: self.storage_path.clone(),
        })
    }
}
