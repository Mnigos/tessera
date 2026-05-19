---
name: conventional-commit
description: Use when the user explicitly asks to create a commit or generate a Conventional Commit from current repository changes.
---

# Conventional Commit

Use this skill only when the user explicitly asks to commit.

## Flow

1. Inspect `git status`.
2. Inspect staged and unstaged diffs for the intended scope.
3. Compare the diff with user intent and avoid unrelated user changes.
4. Before staging/committing code changes, run the full validation set:
   - `bun run typecheck`
   - `bun run check:fix`
   - `bun run test`
   - `bun --filter @repo/api test:integration`
   - `bun run test:e2e`
   - `bun run test:e2e:git`
5. If integration or E2E tests cannot run because the database is not running, stop and ask the user to launch the database before committing.
6. Stage only intended files when staging is needed.
7. Create a concise Conventional Commit message.
8. Commit.

## Message Rules

- Use `type(scope): subject` when a clear scope exists.
- Use imperative mood.
- Keep the subject concise.
- Add a body only when the change needs context, tradeoffs, or migration notes.
- Use a breaking change footer only for actual breaking changes.

## Safety Rules

- Never commit unless the user explicitly asked.
- Never include unrelated changes.
- Prefer small scoped commits when the diff contains multiple logical changes.
- Do not create branches, GitHub comments, or discussions unless explicitly asked.
