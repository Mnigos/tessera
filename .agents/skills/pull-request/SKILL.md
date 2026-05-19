---
name: pull-request
description: Use when the user asks to open, create, or prepare a GitHub pull request from the current branch.
---

# Pull Request

Use this skill when the user asks for a PR.

## Related Skills

- Use `conventional-commit` when uncommitted changes must be committed.
- Use `linear-workflow` when a Linear ticket is discoverable from the branch, commits, or user request.

## Flow

1. Inspect branch, status, recent commits, and diff against the base branch.
2. If uncommitted changes exist, confirm they are intended by the PR request, then commit them with `conventional-commit`.
3. Before pushing code changes, run the full validation set:
   - `bun run typecheck`
   - `bun run check:fix`
   - `bun run test`
   - `bun --filter @repo/api test:integration`
   - `bun run test:e2e`
   - `bun run test:e2e:git`
4. If integration or E2E tests cannot run because the database is not running, stop and ask the user to launch the database before pushing.
5. Push the current branch.
6. Open a ready-for-review PR unless the user explicitly asks for draft.
7. Include summary, validation, important risks, and linked issue when discoverable.

## Rules

- Always open ready-for-review PRs unless draft is explicitly requested.
- Do not create `codex/` branches.
- Do not create GitHub comments or discussions unless explicitly asked.
- Do not create new labels.
- Prefer GitHub connector/app workflow when available; use `gh` when needed.
- Before editing files while preparing a PR, read at least 3 similar files.
