---
name: inline-review-markers
description: Finds, triages, and fixes inline code review markers left in source files. Use when the user mentions `//REVIEW:`, `REVIEW:`, inline review comments, or asks to fix review markers in code.
---

# Inline Review Markers

Use this skill when review feedback has been left directly in files as comments such as `//REVIEW:`.

## Flow

1. Scan broadly before editing:
   - exact requested marker, such as `//REVIEW:`
   - marker without comment syntax, such as `REVIEW:`
   - lowercase variants
   - block-comment variants
   - nearby action markers: `TODO`, `FIXME`, `BUG`, `HACK`, `XXX`
2. Ignore false positives in generated files, lockfiles, hashes, vendored code, `target/`, and `node_modules/` unless the user explicitly targets them.
3. Convert each real marker into a checklist item with file path, line, requested change, and affected domain.
4. Read the relevant domain skill and at least 3 similar files before non-trivial edits.
5. Fix valid markers by changing code, tests, or structure; remove the marker only when the requested issue is addressed.
6. Run focused checks for touched areas, then repo-required checks when the change is broad.
7. Rerun the broad marker scan before finishing and report any remaining markers with reasons.

## Rules

- Do not stop after the first marker search if the user names one exact syntax.
- Do not delete a marker without addressing the underlying feedback.
- Do not treat lockfile/hash substring matches as actionable markers.
- Do not create commits, branches, GitHub comments, or discussions unless explicitly asked.
