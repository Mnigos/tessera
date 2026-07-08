# Design

Brand: **detent**. A detent is the machined catch that holds a mechanism in a precise, known position. The interface is an instrument for measuring change: calm, exact, warm-dark.

Scene that drives the theme: a release engineer at 23:00 in a dim hardware lab, verifying that what shipped matches what was tagged, reading the repo the way a metrologist reads a micrometer.

## Theme

Dark-first, always. Light tokens exist for future use but never drive design decisions. The app shell hardcodes `.dark`.

## Color

Strategy: Restrained in product UI, Committed amber moments on the landing. All values OKLCH, defined in `tooling/tailwind-config/theme.css`. Neutrals are warm charcoal (hue 80, chroma 0.006 to 0.012), never pure gray or pure black.

| Role | Dark value | Usage |
| --- | --- | --- |
| background | `oklch(0.17 0.008 80)` | page ground |
| card | `oklch(0.21 0.009 80)` | panels, raised surfaces |
| border | `oklch(0.29 0.011 80)` | hairlines; prefer `border/60` for faint rules |
| foreground | `oklch(0.92 0.012 85)` | primary text |
| muted-foreground | `oklch(0.70 0.014 82)` | secondary text |
| primary | `oklch(0.80 0.14 80)` | lamp amber: primary actions, selection, the dial index |
| destructive | `oklch(0.68 0.19 25)` | destructive actions and errors |
| chart-1..5 | amber ramp, hue 71 to 84 | data viz |

Rules: the amber accent marks action and state, never decoration. State indicators always pair color with an icon or label. No glow shadows, no gradients, no gradient text, no side-stripe borders, no glassmorphism.

## Typography

- UI and display: `Hanken Grotesk Variable` (`--font-sans`, the html default). Hierarchy through weight (semibold headings) and a tight scale; `tracking-tight` on headings.
- Code and data: `Geist Mono Variable` (`--font-mono`). Used for code, hashes, refs, counts, clone URLs, and engraved labels (uppercase, `text-xs`, `tracking-[0.12em]`, muted).
- Tabular numerals (`tabular-nums`) wherever digits align.
- Upgrade path when licensing allows: Suisse Int'l and Berkeley Mono are the reference faces this system approximates.

## Layout

- Top navbar shell, `max-w-6xl` centered content.
- Instrument furniture: hairline rules (`border-border/60`), ruled section headings (mono label + running hairline), tick-mark and dial motifs in SVG.
- Density serves reading code; prose stays at 65 to 75ch (`max-w-prose`).
- Radius is small: `--radius: 0.3rem`.

## Motion

150 to 160ms, ease-out, color and small transform only. Motion conveys state (a click into position), never decoration. No bounce, no elastic, no glow-on-hover, no layout-property animation. Respect `prefers-reduced-motion`.

## Brand assets

- Mark: dial with radial ticks and an amber index line plus center dot. Component: `apps/web/src/shared/components/detent-mark.tsx`. Favicon: `apps/web/public/favicon.svg`.
- Wordmark: lowercase `detent`, semibold, tracking-tight, always next to the mark in the shell.
- Voice: calm, technical, first-person-plural avoided; the product measures, holds, verifies. No em dashes in copy.
