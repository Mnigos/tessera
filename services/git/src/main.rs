use tessera_git::proto::git_storage_service_server::GitStorageServiceServer;
use tessera_git::smart_http::http::router;
use tessera_git::ssh::SshGitApplication;
use tessera_git::ssh::infrastructure::{
    ApiSshGitAuthorizer, GitSshBackend, SshGitServer, load_or_generate_host_key, run_ssh_server,
};
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
        GitSshBackend::new(config.git_binary.clone()),
    );
    let ssh_server = SshGitServer::new(ssh_application, config.git_binary.clone());
    let ssh_config = std::sync::Arc::new(russh::server::Config {
        keys: vec![ssh_host_key],
        ..Default::default()
    });

    let grpc_server = async {
        Server::builder()
            .add_service(GitStorageServiceServer::new(grpc_service))
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

    tokio::try_join!(grpc_server, http_server, ssh_server)?;

    Ok(())
}
