use tessera_git::proto::git_storage_service_server::GitStorageServiceServer;
use tessera_git::smart_http::http::router;
use tessera_git::ssh::SshGitApplication;
use tessera_git::ssh::infrastructure::{
    ApiSshGitAuthorizer, SshGitServer, SshServerLimits, load_or_generate_host_key, run_ssh_server,
};
use tessera_git::storage::grpc::storage_grpc_auth_interceptor;
use tessera_git::storage::infrastructure::RepositoryStorage;
use tessera_git::{Config, GitStorageGrpcService};
use tokio::net::TcpListener;
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = Config::from_env()?;
    let addr = config.socket_addr()?;
    let http_addr = config.http_socket_addr()?;
    let ssh_addr = config.ssh_socket_addr()?;
    let storage_grpc_authorization_token = config.storage_grpc_authorization_token.clone();
    let ssh_host_key = load_or_generate_host_key(&config.ssh_host_key_path).await?;
    let grpc_service = GitStorageGrpcService::new(config.clone());
    let http_router = router(config.clone());
    let http_listener = TcpListener::bind(http_addr).await?;
    let ssh_listener = TcpListener::bind(ssh_addr).await?;
    let ssh_application = SshGitApplication::new(
        ApiSshGitAuthorizer::new(
            config.api_grpc_url.clone(),
            config.api_grpc_authorization_token.clone(),
        ),
        RepositoryStorage::new(config.storage_root.clone(), config.git_binary.clone()),
    );
    let ssh_server = SshGitServer::new(ssh_application, config.git_binary.clone());
    let ssh_limits = SshServerLimits {
        max_connections: config.ssh_max_connections,
        handshake_timeout: config.ssh_handshake_timeout,
    };
    let ssh_config = std::sync::Arc::new(russh::server::Config {
        keys: vec![ssh_host_key],
        // Garbage-collect idle sessions quickly so an authenticated-but-idle
        // connection cannot occupy a slot indefinitely.
        inactivity_timeout: Some(config.ssh_inactivity_timeout),
        // Constant-time auth rejection with no artificial delay on the initial
        // "none" probe, and a low cap on authentication attempts per connection.
        auth_rejection_time: std::time::Duration::from_secs(1),
        auth_rejection_time_initial: Some(std::time::Duration::from_secs(0)),
        max_auth_attempts: 3,
        // Disable server-initiated keepalives. In russh 0.62.6 any received packet,
        // including a client's reply to a keepalive probe, resets the inactivity
        // timer; with keepalives enabled a responsive but otherwise idle client
        // could hold its session open indefinitely. Leaving keepalive_interval as
        // None keeps `inactivity_timeout` a true hard idle limit.
        keepalive_interval: None,
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
    let ssh_server =
        async { run_ssh_server(ssh_listener, ssh_config, ssh_server, ssh_limits).await };

    tokio::try_join!(grpc_server, http_server, ssh_server)?;

    Ok(())
}
