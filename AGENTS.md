# Tessera Agent Rules

## Security

- Never read `.env` files or files containing secrets or credentials.

## Communication

- Be concise when reporting information.
- Prefer concrete file paths, commands, and outcomes over broad narration.
- When adding or requiring an environment variable, explicitly tell the user and provide either a safe example value or instructions for obtaining the value.

## Before Editing

- Before creating or editing non-trivial files, read matching skill(s), similar files, and uncertain imported dependency implementations or types.
- Live repo patterns beat examples and assumptions.
- When adding Tessera code, heavily inspect `/Users/mnigos/Documents/repositories/personal-apps/game-notes` and `/Users/mnigos/Documents/repositories/rigtch/rigtch-fm` first.
- Use `game-notes` as the primary reference for DDD module structure, API layering, contracts, auth proxying, and code style.
- Use `rigtch-fm` as the primary reference for production infrastructure such as queues, storage, billing, CI, Sentry, editor settings, and deployment polish.

## Skill Usage

- If a task matches an available skill, read that skill before research, planning, creating, or editing files.
- Use domain skills for detailed patterns:
  - `api-patterns`
  - `database-patterns`
  - `web-app-patterns`
  - `ui-components`
  - `testing-patterns`
  - `orpc-contracts`
  - `zod-schemas`
  - `better-auth`
  - `rust-service-patterns`
  - `impeccable` for UI/design craft

## Code Style

- Prefer `function` declarations for extracted block-body functions.
- Use arrows for callbacks and concise expression helpers.
- Keep params/props interfaces directly above their use.
- Destructure params or input objects when only their fields are used.
- Use app aliases and package imports; avoid cross-app relative imports.
- Do not create frontend barrel files in `apps/web`.
- Use kebab-case file names.
- Use descriptive names; avoid cryptic single-letter callback variables.
- Use interfaces for object shapes.
- Use type aliases for unions, primitives, and computed types.
- Prefer `T[]` array syntax instead of `Array<T>`; for arrays of object shapes, create a small named interface or type and use `Type[]`.
- Avoid redundant return types; keep explicit types for public/API contract surfaces.
- Use `Promise.all` for independent async work.
- Assign awaited results to named variables before transforming them; avoid chaining like `(await something()).map(...)`.
- Prefer `undefined` at API boundaries.
- Use `null` only for persistence or external contracts that require explicit clear.
- Use `??` for nullish checks and `||` for all-falsy checks.
- Use early returns.
- Do not use non-null assertions.
- Do not add trivial one-use pass-through helpers.
- Skip braces for single-statement blocks.
- Do not add comments unless explicitly asked.
- Services must import and reuse Zod-inferred types from contract schemas instead of redefining inline.
- Services must delegate raw database queries to repositories.
- Utils are global and domain-agnostic; helpers are module-specific and domain-aware.

## Zod

- Use Zod v4 top-level validators like `z.url()`, `z.email()`, and `z.uuid()`.
- Use `.optional()` instead of `.nullable()` in contract schemas.
- Use `z.coerce.number()` and `z.coerce.date()` for GET query/search params.

## Frontend Data

- Use `useQuery` with explicit loading, error, empty, and success states.
- Pass all options inside `queryOptions()`.

## Quality

- Run relevant checks before finishing:
  - `bun run typecheck`
  - `bun run check:fix`
  - `bun run test`

## Git And GitHub

- Never commit unless explicitly asked.
- Never create GitHub comments or discussions unless asked.
- Never create `codex/` branches.
- Open ready-for-review PRs by default.
- Do not create labels.
