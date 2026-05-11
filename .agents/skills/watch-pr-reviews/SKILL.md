---
name: watch-pr-reviews
description: Use when the user asks to watch an open PR for review comments, Bugbot comments, CodeRabbit comments, or follow-up review feedback.
---

# Watch PR Reviews

Use this skill to watch a PR for actionable review feedback during the current turn.

## Related Skills

- Use `fix-review-findings` for actionable findings.
- Use `pull-request` when watching after opening a PR.
- Use `conventional-commit` when fixes need commits and the user asked for that workflow.

## Flow

1. Identify the open PR from the current branch or the user's URL.
2. Poll PR review comments and PR comments every 1-3 minutes for up to 15 minutes.
3. If actionable findings appear, use `fix-review-findings`.
4. Commit and push valid fixes only when the user asked for commits or PR-fix automation.
5. Restart the 15-minute watch window after pushing fixes.
6. Stop after a full watch window with no actionable findings.

## Rules

- Verify every finding before fixing.
- Do not create GitHub comments or discussions unless the user explicitly asks.
- Do not run indefinitely without an explicit automation or follow-up request.
- If the user wants background watching after the current turn, use a thread heartbeat automation.
