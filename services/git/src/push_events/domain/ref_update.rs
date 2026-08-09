const HEADS_REF_PREFIX: &str = "refs/heads/";

/// One `<old> <new> <ref>` line of post-receive input that is worth reporting:
/// an existing branch that moved. Creations, deletions, tags, and refs that did
/// not move are dropped while parsing, because none of them move a pull
/// request's source branch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PushRefUpdate {
    pub ref_name: String,
    pub old_sha: String,
    pub new_sha: String,
}

/// How a branch got where it is. Decided while the old commit is still
/// reachable, because a later rewrite can leave it unreachable and eventually
/// pruned.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PushRefUpdateKind {
    HeadUpdated,
    ForcePushed,
}

pub fn parse_post_receive_updates(input: &str) -> Vec<PushRefUpdate> {
    input.lines().filter_map(parse_post_receive_line).collect()
}

fn parse_post_receive_line(line: &str) -> Option<PushRefUpdate> {
    let mut fields = line.split_whitespace();
    let old_sha = fields.next()?;
    let new_sha = fields.next()?;
    let ref_name = fields.next()?;

    if fields.next().is_some() {
        return None;
    }

    if !is_object_id(old_sha) || !is_object_id(new_sha) {
        return None;
    }

    if is_null_object_id(old_sha) || is_null_object_id(new_sha) || old_sha == new_sha {
        return None;
    }

    if !ref_name
        .strip_prefix(HEADS_REF_PREFIX)
        .is_some_and(|branch| !branch.is_empty())
    {
        return None;
    }

    Some(PushRefUpdate {
        ref_name: ref_name.to_string(),
        old_sha: old_sha.to_string(),
        new_sha: new_sha.to_string(),
    })
}

fn is_object_id(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn is_null_object_id(value: &str) -> bool {
    value.bytes().all(|byte| byte == b'0')
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD_SHA: &str = "1111111111111111111111111111111111111111";
    const NEW_SHA: &str = "2222222222222222222222222222222222222222";
    const NULL_SHA: &str = "0000000000000000000000000000000000000000";

    #[test]
    fn parses_every_moved_branch() {
        let updates = parse_post_receive_updates(&format!(
            "{OLD_SHA} {NEW_SHA} refs/heads/feature\n{NEW_SHA} {OLD_SHA} refs/heads/other\n"
        ));

        assert_eq!(
            updates,
            vec![
                PushRefUpdate {
                    ref_name: "refs/heads/feature".to_string(),
                    old_sha: OLD_SHA.to_string(),
                    new_sha: NEW_SHA.to_string(),
                },
                PushRefUpdate {
                    ref_name: "refs/heads/other".to_string(),
                    old_sha: NEW_SHA.to_string(),
                    new_sha: OLD_SHA.to_string(),
                },
            ]
        );
    }

    #[test]
    fn skips_tags_and_other_references() {
        let updates = parse_post_receive_updates(&format!(
            "{OLD_SHA} {NEW_SHA} refs/tags/v1\n{OLD_SHA} {NEW_SHA} refs/notes/commits\n{OLD_SHA} {NEW_SHA} refs/heads/\n"
        ));

        assert!(updates.is_empty());
    }

    #[test]
    fn skips_branch_creations_deletions_and_unchanged_refs() {
        let updates = parse_post_receive_updates(&format!(
            "{NULL_SHA} {NEW_SHA} refs/heads/created\n{OLD_SHA} {NULL_SHA} refs/heads/deleted\n{OLD_SHA} {OLD_SHA} refs/heads/unchanged\n"
        ));

        assert!(updates.is_empty());
    }

    #[test]
    fn skips_malformed_lines() {
        let updates = parse_post_receive_updates(&format!(
            "\n{OLD_SHA} refs/heads/short\nnot-a-sha {NEW_SHA} refs/heads/feature\n{OLD_SHA} {NEW_SHA} refs/heads/feature extra\n"
        ));

        assert!(updates.is_empty());
    }

    #[test]
    fn accepts_sha256_object_ids() {
        let old_sha = "1".repeat(64);
        let new_sha = "2".repeat(64);

        let updates =
            parse_post_receive_updates(&format!("{old_sha} {new_sha} refs/heads/feature\n"));

        assert_eq!(updates.len(), 1);
    }
}
