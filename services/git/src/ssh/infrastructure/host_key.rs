use std::path::Path;

use russh::keys::{Algorithm, PrivateKey, load_secret_key, ssh_key};
use tokio::fs;

pub async fn load_or_generate_host_key(
    path: &Path,
) -> Result<PrivateKey, Box<dyn std::error::Error>> {
    if fs::try_exists(path).await? {
        return Ok(load_secret_key(path, None)?);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).await?;
    }

    let key = PrivateKey::random(&mut rand::rng(), Algorithm::Ed25519)?;
    let encoded = key.to_openssh(ssh_key::LineEnding::LF)?;
    write_new_host_key(path, encoded.as_bytes()).await?;

    Ok(key)
}

#[cfg(unix)]
async fn write_new_host_key(path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
    use tokio::io::AsyncWriteExt;

    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .await?;
    file.write_all(contents).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn write_new_host_key(path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
    fs::write(path, contents).await
}
