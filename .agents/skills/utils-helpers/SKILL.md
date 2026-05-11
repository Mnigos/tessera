---
name: utils-helpers
description: Utils and helpers organization, extraction decisions, pure functions, JSDoc requirements, and shared helper placement. Use when extracting or modifying reusable utility/helper functions.
---

Use this skill when extracting or changing helper functions, utils, shared transformations, parsing helpers, or small reusable domain functions.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing util or helper files.
- Any imported helper, external utility, or domain type whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Utils are global, domain-agnostic, and reusable across modules.
- Helpers are module-specific and may contain domain logic.
- File names are kebab-case.
- All exported utils and helpers must have JSDoc.
- Prefer pure functions with descriptive names.
- Use function declarations for exported helpers unless an expression-body arrow is clearly cleaner.
- Avoid single-letter and cryptic callback names.
- Keep named interfaces/types directly above the helper that uses them.
- Do not add trivial pass-through helpers that only reshape a couple fields once.
- Domain logic that does not need injected dependencies should be a standalone helper, not a private service method.

## Common Decisions

- Extract when a function is more than 5 lines, reused, and easier to test or reason about outside the caller.
- Keep logic local when extraction would obscure a one-off flow.
- Put module-specific helpers under `apps/api/src/modules/[name]/helpers` or the matching web module.
- Promote to a shared util only when it is domain-agnostic and useful across boundaries.
- Use existing backoff/rate-limit helpers for external API retry patterns before adding new retry logic.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Add focused tests for non-trivial parsing, transformation, or branching behavior.
