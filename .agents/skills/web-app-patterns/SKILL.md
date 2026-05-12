---
name: web-app-patterns
description: TanStack Start routes, loaders, React components, oRPC TanStack Query usage, and web state patterns. Use when creating or modifying apps/web routes, pages, components, hooks, or frontend API calls.
---

Use this skill for `apps/web` application work: TanStack Start routing, loaders, SSR query prefetching, React component composition, local hooks, and oRPC/TanStack Query calls.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing route, page, component, or hook files for the file type you will create or change.
- Any imported component, hook, route API, or query helper whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Routes live under `apps/web/src/routes`; feature UI usually lives under `apps/web/src/modules/[feature]`.
- Route files should contain route config, validation, loader/head logic, and the route component only. Move child UI components, repeated states, and panels into module component files.
- Define route search params in `validateSearch` before reading or writing them.
- Prefer `getRouteApi()` hooks at module scope for route access used by pages and child components.
- Use URL params for shareable state: filters, sort, search query, selected item, pagination, and URL-addressable dialogs.
- Use React state for ephemeral UI only.
- Never use direct `useEffect`; follow the `no-use-effect` skill and existing repo alternatives.
- Do not use `useSuspenseQuery`; use `useQuery` with explicit loading, error, empty, and success states.
- Pass all TanStack Query options inside `queryOptions()` or `mutationOptions()`. Do not spread generated options into another object.
- Use generated oRPC `.queryOptions()` and `.mutationOptions()` directly unless an adapter removes real duplication. Do not add casts, wrapper surfaces, or extra `queryOptions()` wrappers just to satisfy local call shape.
- Name hooks that only wrap a query as `useThingQuery` in `use-thing.query.ts`; reserve broader names like `useThing` for hooks that coordinate more than a single query.
- Use `enabled` for query preconditions.
- Use loaders to prefetch data for SSR when route-level data is known.
- In child loaders, prefer root auth context (`context.user`, `context.session`) over refetching session.
- Components use named props interfaces immediately above the component and `Readonly<ComponentNameProps>`.
- Keep feature UI composed from small, named components. Split large route panels, dialogs, lists, and repeated state blocks into local `components/`, move reusable feature logic into `hooks/`, and move pure transformations/parsers into `helpers/`.
- Use `flex flex-col gap-*` for vertical stack spacing in app UI. Do not use Tailwind `space-y-*`.
- Use shared layout primitives like `Card` for standard bordered/padded panels instead of hand-rolled `border border-border p-*` wrappers.
- When a component mixes data orchestration with several visual states, keep the orchestration component thin and extract loading, error, empty, and success/list rendering into focused child components.
- Do not create frontend barrel files in `apps/web`; import concrete files directly.
- Use direct imports from `@repo/ui`, local `@/` paths, and existing module boundaries.
- Avoid manual memoization; React Compiler handles ordinary component optimization.

## Common Decisions

- Let components or feature hooks own local query behavior when that avoids prop drilling.
- Keep pages as composition layers unless existing nearby pages include small route-specific decisions.
- Prefer component names that describe their role in the surface, such as `DashboardView`, `TaskPanel`, or `LibrarySearchResults`, over vague page-sized names after decomposition.
- Prefer declarative Radix triggers for dialogs; use controlled or URL-based state only when needed.
- Use `.key()` for broad invalidation and `.queryKey()` for exact cache reads/writes.
- For client navigation loader prefetches, mirror existing `cause` handling before adding new patterns.
- For one-off route error checks, compare directly, such as `error.status === 404`; do not introduce single-value status arrays or constants.
- For visual work, also use `frontend-design` and `ui-components` when the task touches reusable primitives or polish.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Run focused component/route tests where they exist, or `bun run test` for behavior changes.
- For meaningful UI changes, verify in browser at desktop and mobile sizes.
