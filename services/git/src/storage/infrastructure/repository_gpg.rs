use std::mem;
use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};

use tokio::fs;
use tokio::process::Command;
use tokio::time::{Duration, timeout};

use crate::domain::{RepositoryError, TrustedGpgKey};
use crate::storage::infrastructure::repository_storage::RepositoryStorage;

#[derive(Debug)]
pub(super) struct IsolatedGpgHome {
    path: PathBuf,
}

impl IsolatedGpgHome {
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for IsolatedGpgHome {
    fn drop(&mut self) {
        let path = mem::take(&mut self.path);

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            let _cleanup = handle.spawn_blocking(move || {
                let _ = std::fs::remove_dir_all(path);
            });
            return;
        }

        let _ = std::fs::remove_dir_all(path);
    }
}

impl RepositoryStorage {
    pub(super) async fn trusted_gpg_home(
        &self,
        trusted_gpg_keys: &[TrustedGpgKey],
    ) -> Result<IsolatedGpgHome, RepositoryError> {
        let public_keys = trusted_public_keys(trusted_gpg_keys);

        let home = IsolatedGpgHome {
            path: create_gpg_home_path()?,
        };

        fs::create_dir(&home.path)
            .await
            .map_err(RepositoryError::StorageIo)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;

            fs::set_permissions(&home.path, std::fs::Permissions::from_mode(0o700))
                .await
                .map_err(RepositoryError::StorageIo)?;
        }

        if !public_keys.is_empty() {
            import_trusted_public_keys(home.path(), &public_keys).await?;
        }

        Ok(home)
    }

    pub(super) async fn git_with_gpg_home<const N: usize>(
        &self,
        repository_path: &Path,
        args: [&str; N],
        gpg_home: &IsolatedGpgHome,
    ) -> Result<Output, RepositoryError> {
        let mut command = Command::new(&self.git_binary);
        command.arg("--git-dir").arg(repository_path).args(args);
        command.env("GNUPGHOME", gpg_home.path());

        timeout(Duration::from_secs(15), command.output())
            .await
            .map_err(|_| RepositoryError::GitProcessFailed)?
            .map_err(RepositoryError::GitProcessIo)
    }
}

pub(super) fn trusted_public_keys(trusted_gpg_keys: &[TrustedGpgKey]) -> Vec<&str> {
    trusted_gpg_keys
        .iter()
        .filter_map(|key| {
            let public_key = key.public_key.trim();

            if public_key.is_empty() {
                return None;
            }

            Some(public_key)
        })
        .collect()
}

fn create_gpg_home_path() -> Result<PathBuf, RepositoryError> {
    let mut base = std::env::temp_dir();
    let process_id = std::process::id();
    let random_suffix = rand::random::<u64>();
    base.push(format!("tessera-git-gpg-{process_id}-{random_suffix:x}"));

    Ok(base)
}

async fn import_trusted_public_keys(
    gpg_home: &Path,
    public_keys: &[&str],
) -> Result<(), RepositoryError> {
    let public_key_input = public_keys.join("\n");
    let mut child = Command::new("gpg")
        .env("GNUPGHOME", gpg_home)
        .args([
            "--batch",
            "--no-tty",
            "--no-options",
            "--no-autostart",
            "--import-options",
            "import-clean",
            "--import",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(RepositoryError::GitProcessIo)?;
    let Some(mut stdin) = child.stdin.take() else {
        return Err(RepositoryError::GitProcessFailed);
    };

    use tokio::io::AsyncWriteExt;
    stdin
        .write_all(public_key_input.as_bytes())
        .await
        .map_err(RepositoryError::GitProcessIo)?;
    drop(stdin);

    let status = match timeout(Duration::from_secs(15), child.wait()).await {
        Ok(status) => status.map_err(RepositoryError::GitProcessIo)?,
        Err(_) => {
            let _ = child.kill().await;
            return Err(RepositoryError::GitProcessFailed);
        }
    };

    if !status.success() {
        return Err(RepositoryError::GitProcessFailed);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trusted_public_keys_ignores_empty_key_material() {
        let keys = [
            TrustedGpgKey {
                key_id: "one".to_string(),
                fingerprint: String::new(),
                public_key: "  ".to_string(),
            },
            TrustedGpgKey {
                key_id: "two".to_string(),
                fingerprint: String::new(),
                public_key: "-----BEGIN PGP PUBLIC KEY BLOCK-----".to_string(),
            },
        ];

        assert_eq!(
            trusted_public_keys(&keys),
            vec!["-----BEGIN PGP PUBLIC KEY BLOCK-----"]
        );
    }

    #[test]
    fn create_gpg_home_path_uses_system_temp_directory() {
        let path = create_gpg_home_path().unwrap();

        assert!(path.starts_with(std::env::temp_dir()));
        assert!(
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("tessera-git-gpg-")
        );
    }
}
