use crate::domain::RepositoryError;

/// The trailer a service-authored merge or squash commit carries. It is a
/// convenience for anyone reading `git log`, not evidence: the operation receipt
/// is what proves who wrote a commit and under which merge.
pub(super) const OPERATION_TRAILER_NAME: &str = "Tessera-Operation";

/// Trailer names Tessera reserves. Caller text is stripped of them before the
/// service appends its own, so a crafted pull request body cannot plant a line
/// that reads like Tessera wrote it.
const RESERVED_TRAILER_PREFIX: &str = "Tessera-";

/// Everything a commit message may not contain, and the one line ending Git
/// stores. A NUL cannot be represented in a commit object at all; a lone CR
/// would survive into the message and make every later line comparison — the
/// legacy trailer scan included — depend on invisible bytes.
fn normalize(value: &str) -> Result<String, RepositoryError> {
    if value.contains('\0') {
        return Err(RepositoryError::InvalidMergeInput);
    }

    Ok(value.replace("\r\n", "\n").replace('\r', "\n"))
}

fn strip_reserved_trailers(value: &str) -> String {
    value
        .lines()
        .filter(|line| !is_reserved_trailer(line))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn is_reserved_trailer(line: &str) -> bool {
    line.trim_start().split_once(':').is_some_and(|(name, _)| {
        let name = name.as_bytes();
        let prefix = RESERVED_TRAILER_PREFIX.as_bytes();

        name.len() > prefix.len()
            && name[..prefix.len()].eq_ignore_ascii_case(prefix)
            && !name.iter().any(u8::is_ascii_whitespace)
    })
}

fn with_operation_trailer(body: &str, operation_id: &str) -> String {
    format!("{body}\n\n{OPERATION_TRAILER_NAME}: {operation_id}\n")
}

/// The message a two-parent merge commit carries.
pub(super) fn merge_commit_message(
    message: &str,
    operation_id: &str,
) -> Result<String, RepositoryError> {
    let body = strip_reserved_trailers(&normalize(message)?);

    if body.is_empty() {
        return Err(RepositoryError::InvalidMergeInput);
    }

    Ok(with_operation_trailer(&body, operation_id))
}

/// The message a squash commit carries. The title is one line because it is a
/// commit subject: a second line in it would silently become the body and push
/// what the caller meant as the body further down.
pub(super) fn squash_commit_message(
    title: &str,
    body: &str,
    operation_id: &str,
) -> Result<String, RepositoryError> {
    let title = strip_reserved_trailers(&normalize(title)?);

    if title.is_empty() || title.contains('\n') {
        return Err(RepositoryError::InvalidMergeInput);
    }

    let body = strip_reserved_trailers(&normalize(body)?);
    let message = if body.is_empty() {
        title
    } else {
        format!("{title}\n\n{body}")
    };

    Ok(with_operation_trailer(&message, operation_id))
}

/// A replayed commit's own message, carried across as the bytes the author
/// wrote. Rebased commits stay theirs, so nothing is appended — including the
/// operation trailer, which would claim Tessera wrote a commit it only moved.
/// Only the line endings are touched, and only in the direction Git stores.
pub(super) fn replayed_commit_message(message: &[u8]) -> Result<Vec<u8>, RepositoryError> {
    if message.contains(&0) {
        return Err(RepositoryError::InvalidMergeInput);
    }

    let mut normalized = Vec::with_capacity(message.len());
    let mut bytes = message.iter().peekable();

    while let Some(byte) = bytes.next() {
        if *byte == b'\r' {
            bytes.next_if_eq(&&b'\n');
            normalized.push(b'\n');
        } else {
            normalized.push(*byte);
        }
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_message_appends_the_operation_trailer() {
        let message = merge_commit_message("Merge pull request #7", "operation").unwrap();

        assert_eq!(
            message,
            "Merge pull request #7\n\nTessera-Operation: operation\n"
        );
    }

    #[test]
    fn merge_message_strips_caller_authored_tessera_trailers() {
        let message = merge_commit_message(
            "Merge\n\nTessera-Operation: forged\ntessera-strategy: forged\nNot-Tessera: kept",
            "operation",
        )
        .unwrap();

        assert_eq!(
            message,
            "Merge\n\nNot-Tessera: kept\n\nTessera-Operation: operation\n"
        );
    }

    #[test]
    fn merge_message_keeps_prose_that_only_mentions_the_prefix() {
        let message =
            merge_commit_message("Merge\n\nTessera- is not a trailer:", "operation").unwrap();

        assert!(message.contains("Tessera- is not a trailer:"));
    }

    #[test]
    fn merge_message_normalizes_windows_line_endings() {
        let message = merge_commit_message("Merge\r\n\r\nBody", "operation").unwrap();

        assert_eq!(message, "Merge\n\nBody\n\nTessera-Operation: operation\n");
    }

    #[test]
    fn merge_message_rejects_nul_and_empty_bodies() {
        assert!(matches!(
            merge_commit_message("Merge\0", "operation"),
            Err(RepositoryError::InvalidMergeInput)
        ));
        assert!(matches!(
            merge_commit_message("   ", "operation"),
            Err(RepositoryError::InvalidMergeInput)
        ));
    }

    #[test]
    fn squash_message_joins_the_title_and_body() {
        let message =
            squash_commit_message("Add search (#7)", "Why it changed", "operation").unwrap();

        assert_eq!(
            message,
            "Add search (#7)\n\nWhy it changed\n\nTessera-Operation: operation\n"
        );
    }

    #[test]
    fn squash_message_omits_an_empty_body() {
        let message = squash_commit_message("Add search (#7)", "  ", "operation").unwrap();

        assert_eq!(message, "Add search (#7)\n\nTessera-Operation: operation\n");
    }

    #[test]
    fn squash_message_rejects_a_multiline_title() {
        assert!(matches!(
            squash_commit_message("Add search\nand more", "", "operation"),
            Err(RepositoryError::InvalidMergeInput)
        ));
    }

    #[test]
    fn replayed_message_is_carried_across_without_a_trailer() {
        let message =
            replayed_commit_message(b"Original\r\n\r\nTessera-Operation: theirs").unwrap();

        assert_eq!(message, b"Original\n\nTessera-Operation: theirs");
    }

    #[test]
    fn replayed_message_keeps_bytes_that_are_not_utf8() {
        let message = replayed_commit_message(b"Caf\xe9\r\n").unwrap();

        assert_eq!(message, b"Caf\xe9\n");
    }
}
