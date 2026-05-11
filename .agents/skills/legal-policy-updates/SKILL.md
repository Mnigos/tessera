---
name: legal-policy-updates
description: Update Terms of Service or Privacy Policy content, dates, and Terms acceptance version wiring. Use when changing legal copy in the web legal pages or when policy changes require renewed Terms acceptance.
---

# Legal Policy Updates

Use this skill when updating:

- `apps/web/src/modules/legal/content/terms.mdx`
- `apps/web/src/modules/legal/content/privacy.mdx`

Also review:

- `packages/contracts/src/settings.contract.ts`
- `apps/web/src/modules/legal/constants.ts`
- `apps/web/content-collections.ts`

## Terms Of Service Rules

- `terms.mdx` does not own its rendered effective date directly.
- The Terms effective date is driven by `CURRENT_TERMS_OF_SERVICE_VERSION`.
- That value is duplicated intentionally because `apps/web/content-collections.ts` must stay build-safe and cannot import the workspace package entry from `@repo/contracts`.

When Terms change in a way that should require renewed acceptance, update both of these variables to the same `YYYY-MM-DD` value:

1. `packages/contracts/src/settings.contract.ts`
2. `apps/web/src/modules/legal/constants.ts`

Never update only one of them.

## Privacy Policy Rules

- `privacy.mdx` owns its own frontmatter date.
- When Privacy Policy content changes, update the `date` field in `apps/web/src/modules/legal/content/privacy.mdx`.
- Do not update the Terms version variables for a privacy-only change.

## Workflow

1. Read both legal documents and the two Terms version files before editing.
2. Update the legal copy.
3. If Terms changed materially, update both `CURRENT_TERMS_OF_SERVICE_VERSION` values.
4. If Privacy changed, update `privacy.mdx` frontmatter `date`.
5. Keep Terms and Privacy wording aligned when one document references behavior described in the other.
6. Run:
   - `bun run build:web`
   - `bun run typecheck`

## Quick Checklist

- Terms copy updated where needed
- Privacy copy updated where needed
- `packages/contracts/src/settings.contract.ts` updated if Terms version changed
- `apps/web/src/modules/legal/constants.ts` updated if Terms version changed
- Both Terms version values match exactly
- `apps/web/src/modules/legal/content/privacy.mdx` `date` updated if Privacy changed
- `bun run build:web` passes
- `bun run typecheck` passes
