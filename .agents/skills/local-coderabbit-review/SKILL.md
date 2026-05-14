---
name: local-coderabbit-review
description: Run local CodeRabbit review with the `cr` CLI, parse findings, triage them, fix valid issues, and verify the fixes. Use after finishing local changes or when the user asks for a local CodeRabbit/CR review-fix pass.
---

# Local CodeRabbit Review

Use this skill to run the local `cr` CodeRabbit CLI, analyze returned findings, and fix valid issues.

## Related Skills

- Use `fix-review-findings` after CodeRabbit returns findings.
- Use domain skills for touched areas, such as `api-patterns`, `web-app-patterns`, `ui-components`, `testing-patterns`, `database-patterns`, or `rust-service-patterns`.

## Flow

1. Confirm the repo root:
   - `git rev-parse --show-toplevel`
2. Confirm the CLI exists:
   - `command -v cr && cr --version`
   - If missing, report that `cr` is unavailable; do not substitute a manual review and call it CodeRabbit.
3. Check auth:
   - `cr auth status --agent`
   - If unauthenticated, run `cr auth login --agent`, give the user the login URL, wait for completion, then re-check auth.
4. Run review from the repo root:
   - Prefer `cr review --agent -c AGENTS.md` when `AGENTS.md` exists.
   - Otherwise use `cr review --agent`.
   - Treat the review as healthy for up to 10 minutes while it runs.
5. Parse NDJSON output line by line:
   - Collect `finding` events.
   - Preserve severity, file path, and instructions.
   - Ignore `status` events in user-facing summaries.
   - If an `error` event or command failure occurs, report the exact failure and stop.
6. Convert findings into a checklist and use `fix-review-findings`:
   - Verify every finding against current code before editing.
   - Classify each as valid, invalid, duplicate, already fixed, or needs user decision.
   - Fix valid findings only.
7. Add or update tests when behavior changes.
8. Run focused checks for touched areas, then repo-required checks when the change is broad:
   - `bun run typecheck`
   - `bun run check:fix`
   - `bun run test`
9. Rerun the broad marker scan before finishing:
   - `rg -n "//\\s*REVIEW:|/\\*\\s*REVIEW:|REVIEW:|review:|TODO|FIXME|BUG|HACK|XXX" . --glob '!node_modules/**' --glob '!target/**' --glob '!.git/**' --glob '!bun.lock' --glob '!**/generated/**'`
10. Report fixed and not-fixed findings with concise reasons.

## Rules

- Do not create commits, branches, GitHub comments, discussions, or labels unless explicitly asked.
- Do not blindly apply suggestions; verify against current code and project patterns first.
- Do not claim a manual review came from CodeRabbit.
- Do not run review comments or GitHub thread resolution unless explicitly asked.
- Keep fixes scoped to the CodeRabbit findings and necessary tests.
