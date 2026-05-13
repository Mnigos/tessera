use tessera_git::proto::git_storage_service_server::GitStorageServiceServer;
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
    let grpc_service = GitStorageGrpcService::new(config.clone());
    let http_router = tessera_git::smart_http::http::router(config);
    let http_listener = TcpListener::bind(http_addr).await?;

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

    tokio::try_join!(grpc_server, http_server)?;

    Ok(())
}
