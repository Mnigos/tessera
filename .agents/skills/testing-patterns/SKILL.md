---
name: testing-patterns
description: Repo testing conventions for Vitest, Nest testing modules, spies, mocks, controller tests, repositories, helpers, guards, and integration specs.
---

Use this skill when creating, modifying, fixing, or reviewing unit, controller, guard, repository, helper, service, or integration tests.

## First Read

Before editing, read:
- This skill.
- At least 3 existing specs matching the target test type.
- `apps/api/vitest.setup.ts` when touching controller tests or oRPC handler behavior.
- `apps/api/src/shared/test-utils.ts` and `apps/api/src/shared/mocks/` before adding repeated fixtures.
- Any imported dependency, mock factory, testing helper, or external module API whose usage you are not already certain about.

Prefer live specs over examples in this skill.

## Core Rules

- Every non-test file in `apps/api` should have colocated unit tests. When creating or modifying an API file, add or update its matching `.spec.ts` unless the file is declaration-only or wiring-only, such as a pure barrel, type-only file, static constants file, queue token file, or Nest module with no custom factory, middleware, interceptor, or error-handling logic.
- Vitest globals are enabled; do not import `test`, `describe`, `vi`, or `expect`.
- Use `test`, not `it`.
- Use `Test.createTestingModule` for Nest DI tests.
- Put imports first, then `vi.mock`.
- Define module mocks inline in the `vi.mock` factory and assert through imported mocked symbols with `vi.mocked`.
- Do not use `vi.hoisted` or mock variables declared above imports.
- Do not add inline `vi.mock('@orpc/nest', ...)`; controller tests use the global mock in `apps/api/vitest.setup.ts`.
- Before duplicating session, user, userId, request, or domain fixtures, check shared test utilities and mocks; add or extend a factory when the shape repeats across specs.
- Inline assertions when the value is used once; do not assign a one-use `output`, `result`, `user`, `response`, or domain-specific result variable just to assert against it.
- When asked for 100% coverage, configure coverage over meaningful unit-testable layers instead of counting module decorators, barrel files, generated files, or framework bootstrapping. Be explicit about the included paths.
- Do not satisfy coverage by adding brittle tests for files with no behavior. Prefer application, domain, infrastructure, and helper coverage unless the task specifically asks for controller or integration coverage.

## Spies

- Set spies before calling the method under test.
- Name spies after the method plus `Spy`.
- Access private dependencies with bracket notation only when needed.

```typescript
const findFirstSpy = vi.spyOn(repository, 'findFirst').mockResolvedValue(user)
expect(await service.getById(user.id)).toEqual(user)
expect(findFirstSpy).toHaveBeenCalledWith(user.id)
```

## Errors

- For success-path async assertions, use `expect(await asyncCall()).toEqual(...)`.
- Never use `.resolves`; reserve promise matcher syntax for `.rejects` on expected errors.
- Use `.rejects` for async error assertions.
- Store the promise only when making multiple assertions about the same rejection.
- Do not use `try/catch` for expected test errors.

```typescript
const promise = service.getById(missingId)
await expect(promise).rejects.toBeInstanceOf(NotFoundError)
await expect(promise).rejects.toMatchObject({ message: 'user not found' })
```

## Integration Tests
- If an issue, plan, or acceptance criteria explicitly asks for integration coverage, add the integration spec before reporting the task complete.
- Do not claim integration coverage from unit/controller/service specs; name integration status separately in the final validation summary.
- Read comparable integration specs before changing request setup, auth setup, database setup, or response assertions.
- Keep setup explicit and local to the tested behavior unless shared helpers already exist.
- Cover success, unauthorized, forbidden, not found, conflict, bad request, and validation cases when relevant to the endpoint.

## Verification

- Run targeted `bun vitest run <path>` for changed specs.
- Run package-level tests when shared behavior changes.
- Run `bun run typecheck`.
