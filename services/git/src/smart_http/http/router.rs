use axum::Router;
use axum::routing::any;

use crate::config::Config;
use crate::smart_http::application::SmartHttpApplication;
use crate::smart_http::http::request_handler::{handle_smart_http, handle_smart_http_root};
use crate::smart_http::infrastructure::{ApiSmartHttpAuthorizer, GitHttpBackend};
use crate::storage::infrastructure::RepositoryStorage;

pub fn router(config: Config) -> Router {
    tracing::info!(
        http_host = %config.http_host,
        http_port = config.http_port,
        storage_root = %config.storage_root.display(),
        api_authorization_url_configured = !config.api_authorization_url.is_empty(),
        api_token_present = config.api_authorization_token.is_some(),
        "smart_http configured"
    );
    let storage = RepositoryStorage::new(config.storage_root.clone(), config.git_binary.clone());
    let backend = GitHttpBackend::new(config.git_binary);
    let authorizer =
        ApiSmartHttpAuthorizer::new(config.api_authorization_url, config.api_authorization_token);
    let service = SmartHttpApplication::new(authorizer, storage, backend);

    Router::new()
        .route("/{username}/{repo_git}", any(handle_smart_http_root))
        .route("/{username}/{repo_git}/{*path}", any(handle_smart_http))
        .with_state(service)
}
