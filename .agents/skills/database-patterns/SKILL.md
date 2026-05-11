---
name: database-patterns
description: Drizzle schema, migrations, and repository patterns. Use when creating or modifying @packages/db/schema files, generating/running migrations, or writing repository data access in apps/api.
---

Use this skill for database shape and access decisions: schema definitions, branded IDs, indexes, relations, Drizzle migrations, and repository query code.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing schema, migration, or repository files for the file type you will create or change.
- Any imported Drizzle helper, schema helper, or repository dependency whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Schemas live in `packages/db/schema/[name].schema.ts`.
- Repositories live in `apps/api/src/modules/[name]/[name].repository.ts`.
- Define branded ID types on UUID primary and foreign keys.
- Always choose and declare `onDelete` behavior on foreign keys.
- Define indexes and unique indexes in the `pgTable` callback; use partial indexes when nullable uniqueness matters.
- Define relations in the same schema file as the table.
- Export `$inferSelect` and `$inferInsert` types that repositories and services need.
- Keep services free of raw DB queries; delegate data access to repositories.
- Keep table ownership with the bounded context that owns the table. A repository for one module should not query another module's table for ownership or existence checks.
- Repository methods take object params with named interfaces when more than one value is involved.
- Select only needed columns for read models and joined projections.
- Use Drizzle `.set(data)` directly; `undefined` fields are ignored. Pass `null` only when the caller is intentionally clearing a nullable column.
- Handle empty update payloads before issuing an update.
- Use `Promise.all` for independent database reads.
- Do not read `.env` files while working with database commands or config.

## Common Decisions

- Prefer boring repository method names: `find`, `list`, `create`, `update`, `delete`, `upsert`.
- Use domain-specific repository method names when the intent, filter set, side effect, or return shape would be unclear with a generic name.
- Keep repositories pure: no auth checks, business decisions, logging-heavy orchestration, or response shaping that belongs in services.
- Put ownership and authorization checks in services, usually after a repository read.
- If a service needs to verify ownership of data owned by another context, call that context's application service instead of importing its repository or duplicating the query.
- Use schema helpers such as `jsonWithDates` when existing schema files already use them for the same data shape.
- Use `db:push` only for local schema iteration.
- Use `db:generate` for production-ready schema changes and review the generated SQL before relying on it.
- Keep deployed migrations immutable; make a new migration for follow-up changes.
- Keep one migration per feature or logical database change.

## Verification

- For schema changes, run DB package generation or push command appropriate to the task from `packages/db`.
- Review generated SQL in `packages/db/migrations/` when a migration is created.
- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Run focused tests, or `bun run test` when behavior changed.
