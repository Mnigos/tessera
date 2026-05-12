use std::env;
use std::fmt;
use std::net::SocketAddr;
use std::path::PathBuf;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 50051;
const DEFAULT_STORAGE_ROOT: &str = "data/git";
const DEFAULT_GIT_BINARY: &str = "git";

#[derive(Clone, Debug)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub storage_root: PathBuf,
    pub git_binary: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let host = env::var("GIT_SERVICE_HOST").unwrap_or_else(|_| DEFAULT_HOST.to_string());
        let port = env::var("GIT_SERVICE_PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .map_err(|_| ConfigError::InvalidPort)?;
        let storage_root = env::var("GIT_STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_STORAGE_ROOT));
        let git_binary = env::var("GIT_STORAGE_GIT_BINARY")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_GIT_BINARY));

        Ok(Self {
            host,
            port: port.unwrap_or(DEFAULT_PORT),
            storage_root,
            git_binary,
        })
    }

    pub fn socket_addr(&self) -> Result<SocketAddr, ConfigError> {
        format!("{}:{}", self.host, self.port)
            .parse()
            .map_err(|_| ConfigError::InvalidSocketAddress)
    }
}

#[derive(Debug)]
pub enum ConfigError {
    InvalidPort,
    InvalidSocketAddress,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPort => write!(formatter, "GIT_SERVICE_PORT must be a valid TCP port"),
            Self::InvalidSocketAddress => {
                write!(
                    formatter,
                    "GIT_SERVICE_HOST and GIT_SERVICE_PORT must form a socket address"
                )
            }
        }
    }
}

impl std::error::Error for ConfigError {}
