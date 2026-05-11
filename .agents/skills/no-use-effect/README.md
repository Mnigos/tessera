# no-use-effect

A Skill that enforces a strict no-direct-`useEffect` rule in React and React Native codebases.

Based on [Factory's approach](https://x.com/alvinsng/status/1900587498498195) and React's official [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) guide.

## Install

```bash
npx skills add alejandrobailo/no-use-effect
```

## The 6 Rules

1. **Derive state, don't sync it** — Compute during render; no manual memoization in React Compiler codebases
2. **Use React Query** — Fetch with `useQuery` / `useInfiniteQuery` / `useMutation`, not fetch-in-effect
3. **Event handlers, not effects** — User actions belong in handlers
4. **`useMountEffect` for mount-time sync** — Named wrapper for `useEffect(..., [])`
5. **Reset with `key`** — Use React's remount semantics instead of reset effects
6. **Don't patch effects with refs** — If a ref is only controlling effect timing, remove the effect

## What it does

When active, this skill prevents Claude from writing `useEffect` directly in components. Instead, it guides toward the correct primitive for each case: derived state during render, event handlers, React Query, `useSyncExternalStore`, callback refs, key-based resets, or `useMountEffect`.
