---
name: fix-review-findings
description: Use when the user pastes or references code review findings from CodeRabbit, Bugbot, GitHub review comments, or similar and wants valid issues fixed.
---

# Fix Review Findings

Use this skill to triage and fix review findings without blindly applying comments.

## Flow

1. Parse findings into a checklist.
2. Inspect referenced code, surrounding behavior, and relevant tests.
3. Classify each finding as valid, invalid, duplicate, already fixed, or needs user decision.
4. Fix valid findings only.
5. Add or update tests when behavior changes.
6. Run relevant checks.
7. Report fixed and not-fixed findings with reasons.

## Rules

- Verify every finding before editing.
- Keep fixes scoped to validated findings.
- Do not resolve GitHub review threads or create comments unless the user explicitly asks.
- Do not create commits or branches unless explicitly asked.
- Before editing, read at least 3 similar files matching the changed file type.
- Use relevant domain skills such as `testing-patterns`, `api-patterns`, `database-patterns`, `web-app-patterns`, or `ui-components` when the touched area matches them.
