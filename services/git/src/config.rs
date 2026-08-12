use std::env;
use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 50051;
const DEFAULT_HTTP_HOST: &str = "::";
const DEFAULT_HTTP_PORT: u16 = 50052;
const DEFAULT_SSH_HOST: &str = "::";
const DEFAULT_SSH_PORT: u16 = 2222;
const DEFAULT_GIT_BINARY: &str = "git";
const DEFAULT_SSH_MAX_CONNECTIONS: usize = 256;
const DEFAULT_SSH_HANDSHAKE_TIMEOUT_SECS: u64 = 15;
const DEFAULT_SSH_INACTIVITY_TIMEOUT_SECS: u64 = 30;

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub http_host: String,
    pub http_port: u16,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_host_key_path: PathBuf,
    pub ssh_max_connections: usize,
    pub ssh_handshake_timeout: Duration,
    pub ssh_inactivity_timeout: Duration,
    pub storage_root: PathBuf,
    pub git_binary: PathBuf,
    pub api_grpc_url: String,
    pub api_grpc_authorization_token: Option<String>,
    pub storage_grpc_authorization_token: String,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        load_dotenv();

        let host = env::var("GIT_SERVICE_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
        let port = env::var("GIT_SERVICE_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| ConfigError::InvalidPort)?;
        let http_host = env::var("GIT_HTTP_HOST").unwrap_or_else(|_| DEFAULT_HTTP_HOST.to_string());
        let http_port = env::var("GIT_HTTP_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| ConfigError::InvalidHttpPort)?;
        let ssh_host = env::var("GIT_SSH_HOST").unwrap_or_else(|_| DEFAULT_SSH_HOST.to_string());
        let ssh_port = env::var("GIT_SSH_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| ConfigError::InvalidSshPort)?;
        let storage_root = env::var("GIT_STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| default_storage_root());
        let ssh_host_key_path = env::var("GIT_SSH_HOST_KEY_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| storage_root.join("ssh_host_ed25519_key"));
        let ssh_max_connections = env::var("GIT_SSH_MAX_CONNECTIONS")
            .ok()
            .map(|value| value.parse::<usize>())
            .transpose()
            .map_err(|_| ConfigError::InvalidSshMaxConnections)?
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_SSH_MAX_CONNECTIONS);
        let ssh_handshake_timeout = env::var("GIT_SSH_HANDSHAKE_TIMEOUT_SECS")
            .ok()
            .map(|value| value.parse::<u64>())
            .transpose()
            .map_err(|_| ConfigError::InvalidSshHandshakeTimeout)?
            .map(Duration::from_secs)
            .unwrap_or_else(|| Duration::from_secs(DEFAULT_SSH_HANDSHAKE_TIMEOUT_SECS));
        let ssh_inactivity_timeout = env::var("GIT_SSH_INACTIVITY_TIMEOUT_SECS")
            .ok()
            .map(|value| value.parse::<u64>())
            .transpose()
            .map_err(|_| ConfigError::InvalidSshInactivityTimeout)?
            .map(Duration::from_secs)
            .unwrap_or_else(|| Duration::from_secs(DEFAULT_SSH_INACTIVITY_TIMEOUT_SECS));
        let git_binary = env::var("GIT_STORAGE_GIT_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_GIT_BINARY));
        let api_grpc_url = required_env("GIT_API_GRPC_URL", ConfigError::MissingApiGrpcUrl)?;
        let api_grpc_authorization_token = required_env(
            "GIT_API_GRPC_AUTHORIZATION_TOKEN",
            ConfigError::MissingApiGrpcAuthorizationToken,
        )?;
        let storage_grpc_authorization_token = required_env(
            "GIT_STORAGE_GRPC_AUTHORIZATION_TOKEN",
            ConfigError::MissingStorageGrpcAuthorizationToken,
        )?;

        Ok(Self {
            host,
            port: port.unwrap_or(DEFAULT_PORT),
            http_host,
            http_port: http_port.unwrap_or(DEFAULT_HTTP_PORT),
            ssh_host,
            ssh_port: ssh_port.unwrap_or(DEFAULT_SSH_PORT),
            ssh_host_key_path,
            ssh_max_connections,
            ssh_handshake_timeout,
            ssh_inactivity_timeout,
            storage_root,
            git_binary,
            api_grpc_url,
            api_grpc_authorization_token: Some(api_grpc_authorization_token),
            storage_grpc_authorization_token,
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        socket_addr(&self.host, self.port)
    }

    pub fn http_socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        socket_addr(&self.http_host, self.http_port)
    }

    pub fn ssh_socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        socket_addr(&self.ssh_host, self.ssh_port)
    }
}

fn load_dotenv() {
    if env::var("TESSERA_SKIP_ENV_FILE").is_ok_and(|value| value == "true") {
        return;
    }

    if dotenvy::dotenv().is_ok() {
        return;
    }

    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env"));
}

fn default_storage_root() -> PathBuf {
    env::temp_dir().join("tessera-git-storage")
}

fn required_env(name: &str, error: ConfigError) -> Result<String, ConfigError> {
    let value = env::var(name).map_err(|_| error)?;

    if value.trim().is_empty() {
        return Err(error);
    }

    Ok(value)
}

fn socket_addr(host: &str, port: u16) -> Result<SocketAddr, ConfigError> {
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{}]", host)
    } else {
        host.to_string()
    };

    format!("{}:{}", host, port)
        .parse()
        .map_err(|_| ConfigError::InvalidSocketAddress)
}

#[derive(Clone, Copy, Debug)]
pub enum ConfigError {
    InvalidPort,
    InvalidHttpPort,
    InvalidSshPort,
    InvalidSshMaxConnections,
    InvalidSshHandshakeTimeout,
    InvalidSshInactivityTimeout,
    InvalidSocketAddress,
    MissingApiGrpcUrl,
    MissingApiGrpcAuthorizationToken,
    MissingStorageGrpcAuthorizationToken,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPort => write!(formatter, "GIT_SERVICE_PORT must be a valid TCP port"),
            Self::InvalidHttpPort => write!(formatter, "GIT_HTTP_PORT must be a valid TCP port"),
            Self::InvalidSshPort => write!(formatter, "GIT_SSH_PORT must be a valid TCP port"),
            Self::InvalidSshMaxConnections => {
                write!(
                    formatter,
                    "GIT_SSH_MAX_CONNECTIONS must be a positive integer"
                )
            }
            Self::InvalidSshHandshakeTimeout => {
                write!(
                    formatter,
                    "GIT_SSH_HANDSHAKE_TIMEOUT_SECS must be a non-negative integer number of seconds"
                )
            }
            Self::InvalidSshInactivityTimeout => {
                write!(
                    formatter,
                    "GIT_SSH_INACTIVITY_TIMEOUT_SECS must be a non-negative integer number of seconds"
                )
            }
            Self::InvalidSocketAddress => {
                write!(
                    formatter,
                    "configured host and port must form a socket address"
                )
            }
            Self::MissingApiGrpcUrl => {
                write!(formatter, "GIT_API_GRPC_URL is required")
            }
            Self::MissingApiGrpcAuthorizationToken => {
                write!(formatter, "GIT_API_GRPC_AUTHORIZATION_TOKEN is required")
            }
            Self::MissingStorageGrpcAuthorizationToken => {
                write!(
                    formatter,
                    "GIT_STORAGE_GRPC_AUTHORIZATION_TOKEN is required"
                )
            }
        }
    }
}

impl std::error::Error for ConfigError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_storage_root_is_stable_across_process_restarts() {
        assert_eq!(
            default_storage_root(),
            env::temp_dir().join("tessera-git-storage")
        );
    }
}
