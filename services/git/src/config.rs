use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::{env, process};

const DEFAULT_HOST: &str = "::";
const DEFAULT_PORT: u16 = 50051;
const DEFAULT_HTTP_HOST: &str = "::";
const DEFAULT_HTTP_PORT: u16 = 50052;
const DEFAULT_GIT_BINARY: &str = "git";

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub http_host: String,
    pub http_port: u16,
    pub storage_root: PathBuf,
    pub git_binary: PathBuf,
    pub api_grpc_url: String,
    pub api_grpc_authorization_token: Option<String>,
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
        let storage_root = env::var("GIT_STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| default_storage_root());
        let git_binary = env::var("GIT_STORAGE_GIT_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_GIT_BINARY));
        let api_grpc_url = required_env("GIT_API_GRPC_URL", ConfigError::MissingApiGrpcUrl)?;
        let api_grpc_authorization_token = required_env(
            "GIT_API_GRPC_AUTHORIZATION_TOKEN",
            ConfigError::MissingApiGrpcAuthorizationToken,
        )?;

        Ok(Self {
            host,
            port: port.unwrap_or(DEFAULT_PORT),
            http_host,
            http_port: http_port.unwrap_or(DEFAULT_HTTP_PORT),
            storage_root,
            git_binary,
            api_grpc_url,
            api_grpc_authorization_token: Some(api_grpc_authorization_token),
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        socket_addr(&self.host, self.port)
    }

    pub fn http_socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        socket_addr(&self.http_host, self.http_port)
    }
}

fn load_dotenv() {
    if dotenvy::dotenv().is_ok() {
        return;
    }

    let _ = dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env"));
}

fn default_storage_root() -> PathBuf {
    env::temp_dir().join(format!("tessera-git-{}", process::id()))
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
    InvalidSocketAddress,
    MissingApiGrpcUrl,
    MissingApiGrpcAuthorizationToken,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPort => write!(formatter, "GIT_SERVICE_PORT must be a valid TCP port"),
            Self::InvalidHttpPort => write!(formatter, "GIT_HTTP_PORT must be a valid TCP port"),
            Self::InvalidSocketAddress => {
                write!(
                    formatter,
                    "GIT_SERVICE_HOST and GIT_SERVICE_PORT must form a socket address"
                )
            }
            Self::MissingApiGrpcUrl => {
                write!(formatter, "GIT_API_GRPC_URL is required")
            }
            Self::MissingApiGrpcAuthorizationToken => {
                write!(formatter, "GIT_API_GRPC_AUTHORIZATION_TOKEN is required")
            }
        }
    }
}

impl std::error::Error for ConfigError {}
