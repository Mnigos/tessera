---
name: orpc-contracts
description: oRPC contract definitions, route/input/output schemas, error declarations, and exported contract types. Use when creating or modifying contracts in @packages/contracts.
---

Use this skill for API boundary contracts in `packages/contracts`: oRPC routes, input/output schemas, endpoint errors, and types shared with services or web code.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing contract files.
- Any imported schema, shared contract, or oRPC helper whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Contracts live in `packages/contracts/src/[name].contract.ts`.
- Keep route paths, HTTP methods, input schemas, output schemas, and declared errors together.
- Always declare `.output()`.
- Prefer `.route()` then `.errors()` then `.input()` then `.output()` unless nearby contracts use a different local order.
- Export Zod-inferred types that API services or frontend code consume.
- Services must import matching contract types instead of redefining identical inline shapes.
- For shared branded IDs, use `.brand<'brand_key'>()` with the same key as the `@repo/domain` type. If this forces `as unknown as` casts in API mappers, fix the domain brand helper or contract schema instead of keeping the cast.
- Use `z.coerce.number()` and `z.coerce.date()` for GET query/search params that arrive from URLs.
- Use `z.coerce.date()` for output fields that should revive as `Date` after JSON/OpenAPI transport.
- Prefer `.optional()` over `.nullable()` at the API boundary.
- Use `zod-schemas` for Zod v4 details and schema organization decisions.

## Common Decisions

- Reuse schemas across contracts only when they are truly shared API shapes.
- Keep output schema types private unless another package or service needs them.
- Group common error definitions when multiple endpoints share the same error surface.
- Inline small one-off input schemas when that is clearer than naming them.
- Current no-input endpoint patterns are mixed; before enforcing empty `.input(z.object({}).optional())`, check nearby contracts and frontend usage.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Run API or web tests that consume the changed contract, or `bun run test` for shared contract changes.
