---
name: better-auth
description: better-auth server and client integration. Use when configuring packages/auth, Nest AuthModule, auth plugins, OAuth providers, web sign-in/sign-out flows, or frontend session access.
---

Use this skill for authentication changes across `packages/auth`, API auth integration, and web auth flows.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing auth server, auth client, plugin, module, or component files for the file type you will create or change.
- Any imported better-auth plugin, Nest auth helper, or auth client method whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Server auth configuration lives in `packages/auth`; Nest integration lives in the API auth module.
- Web auth client setup lives in `packages/auth/client` and app-level auth client wiring.
- Server plugins and client plugins must align.
- Before adding or debugging a Better Auth plugin with persistence, read the official plugin docs and the installed package source/types for expected model/table names, field names, and API methods.
- For Drizzle-backed Better Auth plugin tables, make the schema export key match Better Auth's model name exactly; do not add explicit adapter schema aliases or workarounds unless the docs or installed adapter types require them.
- Use the better-auth client for sign-in, sign-out, provider redirects, and plugin actions.
- Use oRPC/TanStack Query for web session state; do not use `authClient.useSession()` for app session reads.
- Cross-origin auth fetches need `credentials: 'include'`.
- Keep auth callback URLs and trusted origins aligned with API/app URLs.
- Do not read `.env` files. Use existing env abstractions or names only.
- Do not cast `session.user.id` to branded user ID types; session types already provide the brand when wired correctly.
- Anonymous-user linking and ownership transfer belong in server-side auth integration.

## Common Decisions

- Add both server and client plugin pieces when adding a custom better-auth plugin exposed to web code.
- Keep provider-specific buttons/components small and let auth helpers own shared behavior.
- In route loaders and components, use the existing auth/session query and root route context where possible.
- Treat OAuth provider errors as user-facing flow failures and preserve existing logging/error patterns.
- Coordinate schema or account-field changes with `database-patterns`.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Run auth-focused tests where present, or `bun run test` for behavior changes.
- Manually verify sign-in/sign-out or provider connection flows when UI/auth behavior changes.
