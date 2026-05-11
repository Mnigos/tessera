---
name: api-patterns
description: NestJS API modules, controllers, services, auth decorators, layer boundaries, domain errors, and GlobalExceptionFilter patterns. Use when creating or modifying apps/api modules, controllers, services, guards, API errors, or module exports.
---

Use this skill for API structure and layer decisions in `apps/api`: Nest modules, oRPC controllers, services, auth decorators, exports, and domain error handling.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing module, controller, service, processor, guard, or error-handling files for the file type you will create or change.
- Any imported decorator, service, error class, or helper whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Controllers bind oRPC contracts to handlers, extract session/auth data, and delegate to services.
- Controllers do not contain business logic, repository access, or response reshaping beyond passing contract input onward.
- Use auth decorators from `@modules/auth`; `@RequireAuth()` is a decorator, not a guard.
- Use `@AllowAnonymous()` or `@OptionalAuth()` only when the endpoint truly supports anonymous access.
- Services own business logic, orchestration, ownership checks, domain errors, logging, and calls to other services.
- Services must import and reuse Zod-inferred contract types instead of redefining matching inline shapes.
- Services must not contain raw DB queries; use `database-patterns` for repository work.
- Never use `ORPCError` directly in API code; throw domain errors from `~/shared/errors`.
- Let `GlobalExceptionFilter` map domain errors and unknown errors to API responses.
- Error context is internal logging metadata; do not expose secrets or client-facing data in it.
- Include useful context such as IDs, usernames, constraint names, provider names, or endpoints when throwing domain errors.
- Catch errors only when transforming them, such as database constraint errors into `ConflictError` or `NotFoundError`.
- Do not add try-catch blocks that only rethrow domain errors or wrap unknown errors by default.
- Do not catch errors in repositories; let services transform errors when needed.
- Modules register internal dependencies in `providers` and export only what other modules need.
- Module `index.ts` files should export modules and public providers only; do not export controllers, private helpers, or private interfaces.
- Prefer exporting application services across module boundaries. Do not export or inject another module's repository just to answer a business question; add a small service method such as `findOwnedResource` or `assertOwnedResource`.
- Keep module-specific helpers under the module; move generic helpers only when they meet `utils-helpers` rules.
- Do not add background job infrastructure unless the repository explicitly introduces it first.

## Common Decisions

- Add a repository when persistence access is non-trivial or reused; keep tiny one-off reads out of services only if existing local patterns allow it.
- Prefer service methods that express business actions, not transport details.
- Validate resource existence before ownership checks when that preserves existing API semantics.
- Use specific domain errors: `NotFoundError` for missing resources, `ForbiddenError` for denied access, `ConflictError` for uniqueness conflicts, and external-service errors for provider failures.
- Override domain error messages only when user-facing clarity matters; otherwise rely on default messages.
- Use database error helpers from `~/shared/helpers/database-errors.helper` to map unique and foreign-key violations.
- When wrapping a caught error in an internal or external-service domain error, preserve the original error as the cause if the local error API supports it.
- Export a repository from a module only when another module genuinely needs data access; otherwise export the service.
- When another module needs a fact that belongs to this bounded context, keep raw table access inside this module and expose that fact through the service.
- Keep route files and contracts out of this skill's scope; use `orpc-contracts` and `zod-schemas` for API boundary schema decisions.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Add or update API tests for API behavior changes.
- Run focused tests for changed modules, or `bun run test` when shared behavior changed.
