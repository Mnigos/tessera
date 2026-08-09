use std::env;
use std::fmt;
use std::path::{Path, PathBuf};

use uuid::Uuid;

/// The argument that runs the service binary as the central post-receive hook
/// rather than as the long-running service.
pub const POST_RECEIVE_HOOK_COMMAND: &str = "post-receive-hook";

pub const REPOSITORY_ID_VARIABLE: &str = "TESSERA_REPOSITORY_ID";
pub const ACTOR_USER_ID_VARIABLE: &str = "TESSERA_ACTOR_USER_ID";
pub const PUSH_OPERATION_ID_VARIABLE: &str = "TESSERA_PUSH_OPERATION_ID";

const HOOKS_DIRECTORY: &str = "hooks";
const SPOOL_DIRECTORY: &str = "push-events";

/// Who pushed, into which repository, and under which receive-pack execution.
/// The operation identifier is minted once per execution and is what makes a
/// redelivered notification recognisable as the same push.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PushEventContext {
    pub repository_id: String,
    pub actor_user_id: String,
    pub operation_id: String,
}

impl PushEventContext {
    pub fn new(repository_id: String, actor_user_id: String) -> Self {
        Self {
            repository_id,
            actor_user_id,
            operation_id: Uuid::new_v4().to_string(),
        }
    }
}

/// The central hook and everything it needs to reach the API, resolved once at
/// startup. It is injected per command with `git -c core.hooksPath=…` and is
/// never written into a repository's own configuration, so only client pushes
/// reach the hook — imports, merges, and mirror pushes never do.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PushHookConfig {
    hooks_path: PathBuf,
    storage_root: PathBuf,
    git_binary: PathBuf,
    api_grpc_url: String,
    api_grpc_authorization_token: Option<String>,
}

impl PushHookConfig {
    pub fn new(
        storage_root: PathBuf,
        git_binary: PathBuf,
        api_grpc_url: String,
        api_grpc_authorization_token: Option<String>,
    ) -> Self {
        Self {
            hooks_path: hooks_path(&storage_root),
            storage_root,
            git_binary,
            api_grpc_url,
            api_grpc_authorization_token,
        }
    }

    pub fn hooks_path(&self) -> &Path {
        &self.hooks_path
    }

    pub fn spool_path(&self) -> PathBuf {
        spool_path(&self.storage_root)
    }

    pub fn api_grpc_url(&self) -> &str {
        &self.api_grpc_url
    }

    pub fn api_grpc_authorization_token(&self) -> Option<&str> {
        self.api_grpc_authorization_token.as_deref()
    }

    pub fn hooks_path_argument(&self) -> String {
        format!("core.hooksPath={}", self.hooks_path.display())
    }

    /// The receive-pack environment. Both transports clear the environment
    /// before spawning Git, so everything the hook reads has to be listed here.
    pub fn environment(&self, context: &PushEventContext) -> Vec<(String, String)> {
        let mut environment = vec![
            (
                "GIT_STORAGE_ROOT".to_string(),
                self.storage_root.display().to_string(),
            ),
            (
                "GIT_STORAGE_GIT_BINARY".to_string(),
                self.git_binary.display().to_string(),
            ),
            ("GIT_API_GRPC_URL".to_string(), self.api_grpc_url.clone()),
            (
                REPOSITORY_ID_VARIABLE.to_string(),
                context.repository_id.clone(),
            ),
            (
                ACTOR_USER_ID_VARIABLE.to_string(),
                context.actor_user_id.clone(),
            ),
            (
                PUSH_OPERATION_ID_VARIABLE.to_string(),
                context.operation_id.clone(),
            ),
            ("PATH".to_string(), env::var("PATH").unwrap_or_default()),
        ];

        if let Some(token) = &self.api_grpc_authorization_token {
            environment.push((
                "GIT_API_GRPC_AUTHORIZATION_TOKEN".to_string(),
                token.clone(),
            ));
        }

        environment
    }
}

/// The same contract read from the other side, by the hook process itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PushHookEnvironment {
    pub context: PushEventContext,
    pub storage_root: PathBuf,
    pub git_binary: PathBuf,
    pub api_grpc_url: String,
    pub api_grpc_authorization_token: Option<String>,
}

impl PushHookEnvironment {
    pub fn from_env() -> Result<Self, PushEventError> {
        Self::from_variables(|name| env::var(name).ok())
    }

    pub fn from_variables(read: impl Fn(&str) -> Option<String>) -> Result<Self, PushEventError> {
        let required = |name: &str| {
            read(name)
                .filter(|value| !value.trim().is_empty())
                .ok_or(PushEventError::MissingHookEnvironment)
        };

        Ok(Self {
            context: PushEventContext {
                repository_id: required(REPOSITORY_ID_VARIABLE)?,
                actor_user_id: required(ACTOR_USER_ID_VARIABLE)?,
                operation_id: required(PUSH_OPERATION_ID_VARIABLE)?,
            },
            storage_root: PathBuf::from(required("GIT_STORAGE_ROOT")?),
            git_binary: PathBuf::from(required("GIT_STORAGE_GIT_BINARY")?),
            api_grpc_url: required("GIT_API_GRPC_URL")?,
            api_grpc_authorization_token: read("GIT_API_GRPC_AUTHORIZATION_TOKEN"),
        })
    }

    pub fn spool_path(&self) -> PathBuf {
        spool_path(&self.storage_root)
    }
}

pub fn hooks_path(storage_root: &Path) -> PathBuf {
    storage_root.join(HOOKS_DIRECTORY)
}

pub fn spool_path(storage_root: &Path) -> PathBuf {
    storage_root.join(SPOOL_DIRECTORY)
}

#[derive(Debug)]
pub enum PushEventError {
    MissingHookEnvironment,
    InvalidRepository,
    SpoolIo(std::io::Error),
    /// The spool already holds as many undelivered pushes as it will keep, so
    /// this one is reported lost rather than allowed to crowd out Git objects.
    SpoolFull,
    InvalidSpoolFile,
    /// The API refused the delivery; repeating it cannot help.
    NotificationRejected,
    /// The API could not be reached or failed; the delivery is worth repeating.
    NotificationUnavailable,
}

impl fmt::Display for PushEventError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MissingHookEnvironment => {
                write!(formatter, "post-receive hook environment is incomplete")
            }
            Self::InvalidRepository => write!(formatter, "push repository is invalid"),
            Self::SpoolIo(error) => write!(formatter, "push spool is unwritable: {error}"),
            Self::SpoolFull => write!(formatter, "push spool is full"),
            Self::InvalidSpoolFile => write!(formatter, "spooled push is unreadable"),
            Self::NotificationRejected => write!(formatter, "API rejected the push notification"),
            Self::NotificationUnavailable => {
                write!(formatter, "API did not acknowledge the push notification")
            }
        }
    }
}

impl std::error::Error for PushEventError {}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> PushHookConfig {
        PushHookConfig::new(
            PathBuf::from("/srv/tessera"),
            PathBuf::from("/usr/bin/git"),
            "http://localhost:50051".to_string(),
            Some("service-token".to_string()),
        )
    }

    #[test]
    fn resolves_hook_and_spool_paths_under_the_storage_root() {
        let config = config();

        assert_eq!(config.hooks_path(), Path::new("/srv/tessera/hooks"));
        assert_eq!(
            config.spool_path(),
            PathBuf::from("/srv/tessera/push-events")
        );
        assert_eq!(
            config.hooks_path_argument(),
            "core.hooksPath=/srv/tessera/hooks"
        );
    }

    #[test]
    fn injects_repository_actor_and_operation_into_the_hook_environment() {
        let context = PushEventContext::new("repository".to_string(), "actor".to_string());

        let environment = config().environment(&context);

        assert!(
            environment.contains(&(REPOSITORY_ID_VARIABLE.to_string(), "repository".to_string()))
        );
        assert!(environment.contains(&(ACTOR_USER_ID_VARIABLE.to_string(), "actor".to_string())));
        assert!(environment.contains(&(
            PUSH_OPERATION_ID_VARIABLE.to_string(),
            context.operation_id.clone()
        )));
        assert!(environment.contains(&(
            "GIT_API_GRPC_AUTHORIZATION_TOKEN".to_string(),
            "service-token".to_string()
        )));
    }

    #[test]
    fn omits_the_authorization_token_when_none_is_configured() {
        let config = PushHookConfig::new(
            PathBuf::from("/srv/tessera"),
            PathBuf::from("git"),
            "http://localhost:50051".to_string(),
            None,
        );
        let context = PushEventContext::new("repository".to_string(), "actor".to_string());

        let environment = config.environment(&context);

        assert!(
            !environment
                .iter()
                .any(|(name, _)| name == "GIT_API_GRPC_AUTHORIZATION_TOKEN")
        );
    }

    #[test]
    fn the_injected_environment_is_everything_the_hook_reads() {
        let config = config();
        let context = PushEventContext::new("repository".to_string(), "actor".to_string());
        let environment = config.environment(&context);

        let hook = PushHookEnvironment::from_variables(|name| {
            environment
                .iter()
                .find(|(variable, _)| variable == name)
                .map(|(_, value)| value.clone())
        })
        .unwrap();

        assert_eq!(
            hook,
            PushHookEnvironment {
                context,
                storage_root: PathBuf::from("/srv/tessera"),
                git_binary: PathBuf::from("/usr/bin/git"),
                api_grpc_url: "http://localhost:50051".to_string(),
                api_grpc_authorization_token: Some("service-token".to_string()),
            }
        );
        assert_eq!(hook.spool_path(), config.spool_path());
    }

    #[test]
    fn refuses_an_incomplete_hook_environment() {
        let error = PushHookEnvironment::from_variables(|name| {
            (name == REPOSITORY_ID_VARIABLE).then(|| "repository".to_string())
        })
        .unwrap_err();

        assert!(matches!(error, PushEventError::MissingHookEnvironment));
    }

    #[test]
    fn mints_one_operation_identifier_per_context() {
        let first = PushEventContext::new("repository".to_string(), "actor".to_string());
        let second = PushEventContext::new("repository".to_string(), "actor".to_string());

        assert_ne!(first.operation_id, second.operation_id);
    }
}
