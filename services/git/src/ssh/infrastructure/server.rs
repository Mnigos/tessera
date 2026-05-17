use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use russh::keys::ssh_key::{HashAlg, PublicKey};
use russh::server::{Auth, Handler, Msg, Server as RusshServer, Session};
use russh::{Channel, ChannelId};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::process::ChildStdin;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::ssh::application::{
    SshGitApplication, SshGitAuthenticationRequest, SshGitAuthorizer, authorization_request,
};
use crate::ssh::domain::{SshGitError, parse_ssh_git_command};
use crate::ssh::infrastructure::{GitSshBackendRequest, spawn_git_ssh_process};

#[derive(Clone, Debug)]
pub struct SshGitServer<A> {
    application: SshGitApplication<A>,
    git_binary: PathBuf,
    next_client_id: usize,
}

impl<A> SshGitServer<A>
where
    A: SshGitAuthorizer,
{
    pub fn new(application: SshGitApplication<A>, git_binary: PathBuf) -> Self {
        Self {
            application,
            git_binary,
            next_client_id: 0,
        }
    }
}

impl<A> RusshServer for SshGitServer<A>
where
    A: SshGitAuthorizer,
{
    type Handler = SshGitHandler<A>;

    fn new_client(&mut self, _peer_addr: Option<std::net::SocketAddr>) -> Self::Handler {
        let client_id = self.next_client_id;
        self.next_client_id += 1;

        SshGitHandler {
            application: self.application.clone(),
            git_binary: self.git_binary.clone(),
            client_id,
            authenticated: None,
            channels: HashMap::new(),
        }
    }
}

pub async fn run_ssh_server<A>(
    listener: TcpListener,
    config: Arc<russh::server::Config>,
    mut server: SshGitServer<A>,
) -> Result<(), Box<dyn std::error::Error>>
where
    A: SshGitAuthorizer,
{
    server
        .run_on_socket(config, &listener)
        .await
        .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })
}

#[derive(Debug)]
pub struct SshGitHandler<A> {
    application: SshGitApplication<A>,
    git_binary: PathBuf,
    client_id: usize,
    authenticated: Option<AuthenticatedSshUser>,
    channels: HashMap<ChannelId, Arc<Mutex<Option<ChildStdin>>>>,
}

#[derive(Clone, Debug)]
struct AuthenticatedSshUser {
    username: String,
    public_key_fingerprint: String,
}

impl<A> Handler for SshGitHandler<A>
where
    A: SshGitAuthorizer,
{
    type Error = russh::Error;

    async fn auth_publickey(
        &mut self,
        user: &str,
        public_key: &PublicKey,
    ) -> Result<Auth, Self::Error> {
        let public_key_fingerprint = public_key.fingerprint(HashAlg::Sha256).to_string();
        let authentication = self
            .application
            .authenticate_public_key(SshGitAuthenticationRequest {
                username: user.to_string(),
                public_key_fingerprint: public_key_fingerprint.clone(),
            })
            .await;

        if let Err(error) = authentication {
            tracing::warn!(username = %user, error = %error, "rejecting SSH public key");
            return Ok(Auth::Reject {
                proceed_with_methods: None,
                partial_success: false,
            });
        }

        self.authenticated = Some(AuthenticatedSshUser {
            username: user.to_string(),
            public_key_fingerprint,
        });

        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let authenticated = match self.authenticated.clone() {
            Some(authenticated) => authenticated,
            None => {
                reject_exec(channel, session, SshGitError::Unauthorized)?;
                return Ok(());
            }
        };
        let command = match std::str::from_utf8(data)
            .map_err(|_| SshGitError::InvalidCommand)
            .and_then(parse_ssh_git_command)
        {
            Ok(command) => command,
            Err(error) => {
                reject_exec(channel, session, error)?;
                return Ok(());
            }
        };
        let operation = command.operation;
        let authorized = match self
            .application
            .authorize(authorization_request(
                authenticated.username,
                authenticated.public_key_fingerprint,
                command,
            ))
            .await
        {
            Ok(authorized) => authorized,
            Err(error) => {
                reject_exec(channel, session, error)?;
                return Ok(());
            }
        };
        let mut child = match spawn_git_ssh_process(
            self.git_binary.clone(),
            GitSshBackendRequest {
                operation,
                repository_path: authorized.repository_path,
            },
        ) {
            Ok(child) => child,
            Err(error) => {
                reject_exec(channel, session, error)?;
                return Ok(());
            }
        };

        session.channel_success(channel)?;

        let stdout_reader = child
            .stdout
            .take()
            .map(|stdout| spawn_channel_reader(session.handle(), channel, stdout, false));
        let stderr_reader = child
            .stderr
            .take()
            .map(|stderr| spawn_channel_reader(session.handle(), channel, stderr, true));
        self.channels
            .insert(channel, Arc::new(Mutex::new(child.stdin.take())));

        let handle = session.handle();
        let client_id = self.client_id;
        tokio::spawn(async move {
            let exit_status = child
                .wait()
                .await
                .ok()
                .and_then(|status| status.code())
                .map_or(1, |code| code as u32);
            wait_for_channel_reader(stdout_reader).await;
            wait_for_channel_reader(stderr_reader).await;
            tracing::info!(client_id, exit_status, "SSH Git process exited");
            let _ = handle.exit_status_request(channel, exit_status).await;
            let _ = handle.eof(channel).await;
            let _ = handle.close(channel).await;
        });

        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        if let Some(stdin) = self.channels.get(&channel)
            && let Some(stdin) = stdin.lock().await.as_mut()
        {
            stdin.write_all(data).await.map_err(russh::Error::IO)?;
        }

        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.remove(&channel);
        Ok(())
    }

    async fn channel_close(
        &mut self,
        channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.remove(&channel);
        Ok(())
    }
}

fn reject_exec(
    channel: ChannelId,
    session: &mut Session,
    error: SshGitError,
) -> Result<(), russh::Error> {
    tracing::warn!(error = %error, "rejecting SSH Git exec request");
    session.extended_data(channel, 1, format!("{error}\n").into_bytes())?;
    session.channel_failure(channel)?;
    session.exit_status_request(channel, 1)?;
    session.close(channel)?;
    Ok(())
}

fn spawn_channel_reader<R>(
    handle: russh::server::Handle,
    channel: ChannelId,
    mut reader: R,
    stderr: bool,
) -> JoinHandle<()>
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut buffer = vec![0; 8192];
        loop {
            let read = match reader.read(&mut buffer).await {
                Ok(0) => break,
                Ok(read) => read,
                Err(_) => break,
            };
            let data = bytes::Bytes::copy_from_slice(&buffer[..read]);
            let result = if stderr {
                handle.extended_data(channel, 1, data).await.map(|_| ())
            } else {
                handle.data(channel, data).await.map(|_| ())
            };

            if result.is_err() {
                break;
            }
        }
    })
}

async fn wait_for_channel_reader(reader: Option<JoinHandle<()>>) {
    if let Some(reader) = reader {
        let _ = reader.await;
    }
}
