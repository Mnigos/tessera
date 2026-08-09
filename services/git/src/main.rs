use std::io::Read;
use tessera_git::proto::git_storage_service_server::GitStorageServiceServer;
use tessera_git::push_events::domain::{
    POST_RECEIVE_HOOK_COMMAND, PushHookConfig, PushHookEnvironment,
};
use tessera_git::push_events::infrastructure::{
    ApiPushEventNotifier, PushEventSpool, initialize_hook_logging, install_post_receive_hook,
};
use tessera_git::push_events::{run_post_receive_hook, run_push_event_sweeper};
use tessera_git::smart_http::http::router;
use tessera_git::ssh::SshGitApplication;
use tessera_git::ssh::infrastructure::{
    ApiSshGitAuthorizer, SshGitServer, load_or_generate_host_key, run_ssh_server,
};
use tessera_git::storage::grpc::storage_grpc_auth_interceptor;
use tessera_git::storage::infrastructure::RepositoryStorage;
use tessera_git::{Config, GitStorageGrpcService};

use tokio::net::TcpListener;
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Before any subscriber is installed: the hook writes its diagnostics to a
    // file, because its stderr is relayed to whoever pushed.
    if std::env::args().nth(1).as_deref() == Some(POST_RECEIVE_HOOK_COMMAND) {
        return run_post_receive_hook_command().await;
    }

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let addr = config.socket_addr()?;
    let http_addr = config.http_socket_addr()?;
    let ssh_addr = config.ssh_socket_addr()?;
    let storage_grpc_authorization_token = config.storage_grpc_authorization_token.clone();
    let ssh_host_key = load_or_generate_host_key(&config.ssh_host_key_path).await?;
    let push_hook = install_push_hook(&config).await;
    let grpc_service = GitStorageGrpcService::new(config.clone());
    let http_router = router(config.clone(), push_hook.clone());
    let http_listener = TcpListener::bind(http_addr).await?;
    let ssh_listener = TcpListener::bind(ssh_addr).await?;
    let ssh_application = SshGitApplication::new(
        ApiSshGitAuthorizer::new(
            config.api_grpc_url.clone(),
            config.api_grpc_authorization_token.clone(),
        ),
        RepositoryStorage::new(config.storage_root.clone(), config.git_binary.clone()),
    );
    let ssh_server = SshGitServer::new(
        ssh_application,
        config.git_binary.clone(),
        push_hook.clone(),
    );
    let ssh_config = std::sync::Arc::new(russh::server::Config {
        keys: vec![ssh_host_key],
        ..Default::default()
    });

    let grpc_server = async {
        Server::builder()
            .add_service(GitStorageServiceServer::with_interceptor(
                grpc_service,
                storage_grpc_auth_interceptor(storage_grpc_authorization_token),
            ))
            .serve(addr)
            .await
            .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })
    };
    let http_server = async {
        axum::serve(http_listener, http_router)
            .await
            .map_err(|error| -> Box<dyn std::error::Error> { Box::new(error) })
    };
    let ssh_server = async { run_ssh_server(ssh_listener, ssh_config, ssh_server).await };
    let push_event_sweeper = async {
        if let Some(push_hook) = push_hook {
            run_push_event_sweeper(
                PushEventSpool::new(push_hook.spool_path()),
                ApiPushEventNotifier::new(
                    push_hook.api_grpc_url(),
                    push_hook.api_grpc_authorization_token(),
                ),
            )
            .await;
        }

        Ok(())
    };

    tokio::try_join!(grpc_server, http_server, ssh_server, push_event_sweeper)?;

    Ok(())
}

/// Installs the one hook every receive-pack execution is pointed at. A service
/// that cannot install it still serves Git: pushes keep working, they are just
/// not reported.
async fn install_push_hook(config: &Config) -> Option<PushHookConfig> {
    let push_hook = PushHookConfig::new(
        config.storage_root.clone(),
        config.git_binary.clone(),
        config.api_grpc_url.clone(),
        config.api_grpc_authorization_token.clone(),
    );
    let service_binary = std::env::current_exe()
        .inspect_err(|error| {
            tracing::error!(error = %error, "push events disabled: service binary is unknown");
        })
        .ok()?;

    install_post_receive_hook(push_hook.hooks_path(), &service_binary)
        .await
        .inspect_err(|error| {
            tracing::error!(error = %error, "push events disabled: hook could not be installed");
        })
        .ok()?;

    Some(push_hook)
}

/// Runs as a child of receive-pack, once per push. Its exit status is Git's to
/// report to the client, so it is always success: the refs it describes have
/// already been committed.
async fn run_post_receive_hook_command() -> Result<(), Box<dyn std::error::Error>> {
    // Without the injected context there is nothing to report and nowhere to
    // say so: the log this hook owns lives under the storage root it names.
    let Ok(environment) = PushHookEnvironment::from_env() else {
        return Ok(());
    };

    initialize_hook_logging(&environment.spool_path());

    let mut input = String::new();

    match std::io::stdin().read_to_string(&mut input) {
        Ok(_) => run_post_receive_hook(&environment, &input).await,
        Err(error) => tracing::warn!(error = %error, "post-receive input could not be read"),
    }

    Ok(())
}
