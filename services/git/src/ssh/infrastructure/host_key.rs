use std::path::Path;

use russh::keys::{Algorithm, PrivateKey, load_secret_key, ssh_key};
use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;

pub async fn load_or_generate_host_key(
    path: &Path,
) -> Result<PrivateKey, Box<dyn std::error::Error>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
    let encoded = key.to_openssh(ssh_key::LineEnding::LF)?;
    match write_new_host_key(path, encoded.as_bytes()).await {
        Ok(()) => Ok(key),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            Ok(load_secret_key(path, None)?)
        }
        Err(error) => Err(Box::new(error)),
    }
}

async fn write_new_host_key(path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);

    #[cfg(unix)]
    {
        options.mode(0o600);
    }

    let mut file = options.open(path).await?;
    file.write_all(contents).await?;
    Ok(())
}
