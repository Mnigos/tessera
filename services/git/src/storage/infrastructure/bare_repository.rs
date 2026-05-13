use std::path::Path;

use tokio::fs;

use crate::domain::RepositoryError;

pub async fn is_bare_repository(
    path: &Path,
    repositories_root: &Path,
) -> Result<bool, RepositoryError> {
    let metadata = fs::symlink_metadata(path)
        .await
        .map_err(RepositoryError::StorageIo)?;

    if metadata.file_type().is_symlink() {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    let canonical_repositories_root = fs::canonicalize(repositories_root)
        .await
        .map_err(RepositoryError::StorageIo)?;
    let canonical_path = fs::canonicalize(path)
        .await
        .map_err(RepositoryError::StorageIo)?;

    if !canonical_path.starts_with(canonical_repositories_root) {
        return Err(RepositoryError::PathEscapesStorageRoot);
    }

    for marker_path in [
        path.join("HEAD"),
        path.join("config"),
        path.join("objects"),
        path.join("refs"),
    ] {
        let Ok(marker_metadata) = fs::symlink_metadata(&marker_path).await else {
            return Ok(false);
        };

        if marker_metadata.file_type().is_symlink() {
            return Err(RepositoryError::PathEscapesStorageRoot);
        }
    }

    let config_path = path.join("config");
    let Ok(config) = fs::read_to_string(config_path).await else {
        return Ok(false);
    };

    Ok(fs::metadata(path)
        .await
        .map(|metadata| metadata.is_dir())
        .unwrap_or(false)
        && fs::metadata(path.join("HEAD"))
            .await
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
        && fs::metadata(path.join("objects"))
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
        && fs::metadata(path.join("refs"))
            .await
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false)
        && config_has_core_bare_enabled(&config))
}

fn config_has_core_bare_enabled(config: &str) -> bool {
    let mut in_core_section = false;
    let mut bare = None;

    for line in config.lines().map(str::trim) {
        if let Some(section) = parse_section_header(line) {
            in_core_section = section.eq_ignore_ascii_case("core");
            continue;
        }

        if !in_core_section {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };

        if key.trim().eq_ignore_ascii_case("bare") {
            bare = Some(is_git_truthy(strip_inline_comment(value).trim()));
        }
    }

    bare.unwrap_or(false)
}

fn is_git_truthy(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "true" | "yes" | "on" | "1"
    )
}

fn strip_inline_comment(value: &str) -> &str {
    value
        .split_once([';', '#'])
        .map_or(value, |(before_comment, _)| before_comment)
}

fn parse_section_header(line: &str) -> Option<&str> {
    line.strip_prefix('[')?.strip_suffix(']').map(str::trim)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_bare_check_uses_core_section_last_value() {
        let config = r#"
            [other]
                bare = true
            [core]
                bare = true
                bare = false
        "#;

        assert!(!config_has_core_bare_enabled(config));
    }

    #[test]
    fn config_bare_check_accepts_core_bare_true() {
        let config = r#"
            [other]
                bare = false
            [core]
                bare = false
                bare = true
        "#;

        assert!(config_has_core_bare_enabled(config));
    }

    #[test]
    fn config_bare_check_accepts_case_insensitive_git_booleans() {
        let config = r#"
            [ Core ]
                Bare = Yes
        "#;

        assert!(config_has_core_bare_enabled(config));
    }

    #[test]
    fn config_bare_check_ignores_inline_comments() {
        let config = r#"
            [core]
                bare = true ; repository is bare
                bare = on # last value wins
        "#;

        assert!(config_has_core_bare_enabled(config));
    }
}
