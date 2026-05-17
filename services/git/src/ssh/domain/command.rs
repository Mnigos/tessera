use crate::ssh::domain::{SshGitCommand, SshGitError, SshGitOperation};

pub fn parse_ssh_git_command(input: &str) -> Result<SshGitCommand, SshGitError> {
    let mut parts = input.trim().splitn(2, char::is_whitespace);
    let service = parts.next().ok_or(SshGitError::InvalidCommand)?;
    let repository_path = parts.next().ok_or(SshGitError::InvalidCommand)?.trim();

    if service.is_empty() || repository_path.is_empty() {
        return Err(SshGitError::InvalidCommand);
    }

    let operation = match service {
        "git-upload-pack" => SshGitOperation::UploadPack,
        "git-receive-pack" => SshGitOperation::ReceivePack,
        _ if service.starts_with("git-") => return Err(SshGitError::UnsupportedService),
        _ => return Err(SshGitError::InvalidCommand),
    };

    let repository_path = unquote_single_path(repository_path)?;
    let repository_path = repository_path.strip_prefix('/').unwrap_or(repository_path);
    let Some(repository_path) = repository_path.strip_suffix(".git") else {
        return Err(SshGitError::InvalidRepositoryPath);
    };
    let segments = repository_path.split('/').collect::<Vec<_>>();

    if segments.len() != 2
        || segments
            .iter()
            .any(|segment| segment.is_empty() || *segment == "." || *segment == "..")
    {
        return Err(SshGitError::InvalidRepositoryPath);
    }

    Ok(SshGitCommand {
        owner: segments[0].to_string(),
        repository: segments[1].to_string(),
        operation,
    })
}

fn unquote_single_path(value: &str) -> Result<&str, SshGitError> {
    if let Some(unquoted) = value.strip_prefix('\'') {
        let Some(unquoted) = unquoted.strip_suffix('\'') else {
            return Err(SshGitError::InvalidCommand);
        };

        if unquoted.contains('\'') {
            return Err(SshGitError::InvalidCommand);
        }

        return Ok(unquoted);
    }

    if value.contains(char::is_whitespace) || value.contains('\'') || value.contains('"') {
        return Err(SshGitError::InvalidCommand);
    }

    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_upload_pack_command() {
        let command = parse_ssh_git_command("git-upload-pack mona/repo.git").unwrap();

        assert_eq!(command.owner, "mona");
        assert_eq!(command.repository, "repo");
        assert_eq!(command.operation, SshGitOperation::UploadPack);
    }

    #[test]
    fn parses_quoted_receive_pack_command() {
        let command = parse_ssh_git_command("git-receive-pack 'mona/repo.git'").unwrap();

        assert_eq!(command.owner, "mona");
        assert_eq!(command.repository, "repo");
        assert_eq!(command.operation, SshGitOperation::ReceivePack);
    }

    #[test]
    fn parses_ssh_url_style_absolute_repository_path() {
        let command = parse_ssh_git_command("git-upload-pack '/mona/repo.git'").unwrap();

        assert_eq!(command.owner, "mona");
        assert_eq!(command.repository, "repo");
        assert_eq!(command.operation, SshGitOperation::UploadPack);
    }

    #[test]
    fn rejects_malformed_commands() {
        for input in [
            "",
            "git-upload-pack",
            "git-upload-pack mona/repo",
            "git-upload-pack mona/repo.git extra",
            "git-upload-pack 'mona/repo.git",
            "git-upload-pack mona/../repo.git",
            "git-upload-archive mona/repo.git",
        ] {
            assert!(parse_ssh_git_command(input).is_err(), "{input}");
        }
    }
}
