---
name: ui-components
description: Reusable @packages/ui components, shadcn/ui, Radix primitives, CVA variants, Tailwind styling, and package exports. Use when building or modifying components in @packages/ui.
---

Use this skill for reusable UI primitives in `packages/ui`, including Radix composition, CVA variants, Tailwind classes, and component exports.

## First Read

Before editing, read:
- This skill.
- At least 3 similar existing `packages/ui` component files.
- Any imported Radix primitive, CVA helper, or local UI utility whose API you are not already certain about.

Use those files as the source of truth. Prefer live repo patterns over examples in this skill.

## Working Rules

- Use shadcn/Radix conventions already present in `packages/ui`.
- Export named component functions; do not add default exports.
- Use `ComponentProps<typeof Primitive>` or `ComponentProps<'element'>` for native/primitive props.
- Put params/props interfaces immediately above the component that uses them.
- Use `Readonly<ComponentNameProps>` for component props.
- Use CVA for meaningful variants and export the variants helper when consumers need it.
- Use `cn()` for class merging.
- Prefer `size-*` over paired `h-* w-*`.
- Prefer design tokens and Tailwind utilities over arbitrary values.
- Prefer Tailwind's named utilities and variant shorthands over arbitrary syntax. For boolean data attributes, use `data-ending-style:opacity-0` instead of `data-[ending-style]:opacity-0`; reserve arbitrary values/selectors for cases Tailwind cannot express clearly.
- Use `asChild` and Radix `Slot` only when polymorphic composition is needed.
- Export components through the package's existing export surface; do not create frontend barrels.

## Common Decisions

- Keep reusable primitives in `packages/ui`; keep product-specific UI in `apps/web`.
- Add variants only when multiple consumers or states need a stable API.
- Prefer Radix composed parts for dialogs, popovers, menus, and similar primitives.
- Keep component APIs small; avoid passing app-domain data into UI primitives.
- For app screens or visual polish, also use `web-app-patterns` and `frontend-design`.

## Verification

- Run `bun run typecheck`.
- Run `bun run check:fix`.
- Run UI/component tests or Storybook checks where present.
- For visual changes, verify desktop and mobile rendering.
