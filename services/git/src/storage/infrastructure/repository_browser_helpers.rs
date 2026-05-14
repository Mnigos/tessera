use crate::domain::{RepositoryError, RepositoryTreeEntry, RepositoryTreeEntryKind};

pub(super) fn normalize_requested_ref(value: &str) -> Result<Option<String>, RepositoryError> {
    let value = value.trim();

    if value.is_empty() {
        return Ok(None);
    }

    validate_git_ref(value)?;

    Ok(Some(value.to_string()))
}

pub(super) fn normalize_repository_path(value: &str) -> Result<Option<String>, RepositoryError> {
    if value.is_empty() {
        return Ok(None);
    }

    if value.starts_with('/')
        || value.ends_with('/')
        || value.contains('\0')
        || value.contains('\\')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(RepositoryError::InvalidRepositoryPath);
    }

    Ok(Some(value.to_string()))
}

pub(super) fn validate_git_ref(value: &str) -> Result<(), RepositoryError> {
    if value.is_empty()
        || value.starts_with('-')
        || value.starts_with('/')
        || value.ends_with('/')
        || value.ends_with('.')
        || value.ends_with(".lock")
        || value.contains('\0')
        || value.contains("..")
        || value.contains("//")
        || value.contains("@{")
        || value.contains('\\')
        || value.chars().any(|character| {
            matches!(
                character,
                ' ' | '\t' | '\r' | '\n' | '~' | '^' | ':' | '?' | '*' | '['
            )
        })
        || value.split('/').any(|part| part.starts_with('.'))
    {
        return Err(RepositoryError::InvalidRepositoryRef);
    }

    Ok(())
}

pub(super) fn validate_object_id(value: &str) -> Result<(), RepositoryError> {
    if !(value.len() == 40 || value.len() == 64)
        || !value.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(RepositoryError::InvalidObjectId);
    }

    Ok(())
}

pub(super) fn treeish_path(commit_id: &str, path: &Option<String>) -> String {
    path.as_ref().map_or_else(
        || format!("{commit_id}^{{tree}}"),
        |path| format!("{commit_id}:{path}"),
    )
}

pub(super) fn parse_ls_tree_entries(
    output: &[u8],
    parent_path: &str,
) -> Result<Vec<RepositoryTreeEntry>, RepositoryError> {
    if output.is_empty() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();

    for raw_entry in output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let tab_index = raw_entry
            .iter()
            .position(|byte| *byte == b'\t')
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let metadata = std::str::from_utf8(&raw_entry[..tab_index])
            .map_err(|_| RepositoryError::InvalidGitOutput)?;
        let name = std::str::from_utf8(&raw_entry[tab_index + 1..])
            .map_err(|_| RepositoryError::InvalidGitOutput)?;

        if name.is_empty() || name.contains('/') {
            return Err(RepositoryError::InvalidRepositoryPath);
        }

        let mut metadata_parts = metadata.split_whitespace();
        let mode = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let object_type = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let object_id = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;
        let size = metadata_parts
            .next()
            .ok_or(RepositoryError::InvalidGitOutput)?;

        let kind = match (mode, object_type) {
            ("040000", "tree") => RepositoryTreeEntryKind::Directory,
            ("120000", "blob") => RepositoryTreeEntryKind::Symlink,
            ("160000", "commit") => RepositoryTreeEntryKind::Submodule,
            (_, "blob") => RepositoryTreeEntryKind::File,
            _ => return Err(RepositoryError::InvalidGitOutput),
        };
        let size_bytes = if size == "-" {
            0
        } else {
            size.parse()
                .map_err(|_| RepositoryError::InvalidGitOutput)?
        };

        let path = if parent_path.is_empty() {
            name.to_string()
        } else {
            format!("{parent_path}/{name}")
        };

        entries.push(RepositoryTreeEntry {
            name: name.to_string(),
            object_id: object_id.to_string(),
            kind,
            size_bytes,
            path,
            mode: mode.to_string(),
        });
    }

    entries.sort_by(|left, right| left.name.cmp(&right.name));

    Ok(entries)
}
