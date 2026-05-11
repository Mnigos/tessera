---
name: zod-schemas
description: Zod v4 schema definitions, validation rules, inferred types, coercion, and schema organization. Use when defining input/output schemas, form schemas, internal schemas, or contract schemas.
---

Use this skill for Zod v4 validation in contracts, route search params, forms, internal API parsing, and shared schema files.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing schema or contract files.
- Any imported schema or validator helper whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Use Zod v4 top-level validators: `z.uuid()`, `z.email()`, `z.url()`.
- Shared branded primitives in `packages/domain` must use Zod-compatible `z.$brand` typing. Do not create a separate custom brand shape such as `{ __brand: ... }` when the value also crosses contract schemas.
- Contract schemas that brand shared IDs should use the same brand key as the domain type, so API code can pass domain/DB branded IDs into contract output without `as unknown as` casts.
- For web URLs, prefer `z.url({ protocol: /^https?$/, hostname: z.regexes.domain })`.
- Define inferred types near exported schemas when consumers need the type.
- Prefer `.optional()` over `.nullable()` at API and form boundaries.
- Use `.nullable()` or `.nullish()` only when persistence or an external API genuinely returns `null`.
- Use `z.coerce.number()` and `z.coerce.date()` for URL query/search params.
- Use `z.coerce.date()` for JSON/OpenAPI output that should become `Date` on the client.
- Use `z.record(keySchema, valueSchema)` in Zod v4.
- Keep schema names camelCase with `Schema`; keep inferred types PascalCase.

## Common Decisions

- Put API boundary schemas in contracts unless they are internal-only.
- Put internal module schemas near the module that owns the parsing.
- Export schemas that are reused; keep one-off schemas local.
- Prefer composing with `.pick()`, `.omit()`, `.extend()`, or shared leaf schemas when the relationship is real.
- Avoid large generic schemas that hide endpoint-specific requirements.
- Treat `as unknown as` between contract and domain branded IDs as a signal that the brand helper or schema brand key is wrong.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Run focused validation tests where present, or `bun run test` for behavior changes.
