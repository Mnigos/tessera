use tessera_git::proto::git_storage_service_server::GitStorageServiceServer;
use tessera_git::{Config, GitStorageGrpcService};
use tonic::transport::Server;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::from_env()?;
    let addr = config.socket_addr()?;
    let service = GitStorageGrpcService::new(config);

    Server::builder()
        .add_service(GitStorageServiceServer::new(service))
        .serve(addr)
        .await?;

    Ok(())
}
