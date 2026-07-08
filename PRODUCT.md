# Product

## Register

product

## Users

Developer teams (2–50 people) who want a focused, trustworthy place to host Git repositories, plus individual self-hosters. They are professional engineers living in editors, terminals, and code review. Context of use: long working sessions at a desk, usually in dark environments and dark-themed editors, reading diffs and file trees for minutes at a time. Both self-hosted deployments and a hosted SaaS are first-class from day one. The adoption path matters: most users arrive from GitHub via import → mirror → cutover, so the product must feel immediately credible next to GitHub.

## Product Purpose

An open-source Git collaboration platform: excellent repository hosting, code browsing, pull requests, review workflows, and extensible integrations. Deliberately not a CI/CD platform, issue tracker, or plugin marketplace; it integrates adjacent tools instead of rebuilding them ("core before ecosystem"). Git itself is the storage engine; nothing proprietary sits between the user and their repositories. Success looks like: a team cuts over from GitHub and never feels they downgraded, and browsing/reviewing code here is noticeably better than where they came from.

## Brand Personality

Calm, technical, trustworthy. A serious developer tool with quiet confidence: dense where density serves reading code, restrained everywhere else. It should evoke the feeling of well-maintained infrastructure: something you'd trust with your source code precisely because it doesn't perform for you. Never playful-startup, never enterprise-beige.

## Anti-references

- GitHub's generic marketing gloss and Copilot-era gradient/AI sparkle aesthetic.
- SaaS dashboard clichés: hero metrics, identical card grids, gradient CTAs, glassmorphism.
- Enterprise portal blandness (Bitbucket/Azure DevOps): gray chrome, cramped toolbars, design-by-committee.
- Hackerish edgelord terminal cosplay: green-on-black matrix vibes, scanlines, fake CRT effects.
- The current saturated "Linear-like" minimal dark SaaS look; the redesign should not be guessable from "dev tool, dark mode".

## Design Principles

1. **Code is the interface.** Screens exist to read code, diffs, and history; typography and density decisions optimize for sustained reading, not for marketing screenshots.
2. **Trust through restraint.** Visual authority comes from precision (alignment, hairlines, tabular numbers, consistent rhythm), not decoration. If an element performs rather than informs, cut it.
3. **Dark-first, always.** The primary theme is dark, designed as a lit instrument for dim rooms, not as inverted light mode. Light mode may follow later; it is never the design driver.
4. **Migration must feel safe.** Import, mirror, and cutover flows carry real risk for users; their UI over-communicates state, direction of sync, and reversibility.
5. **Self-hosted and SaaS are the same product.** No degraded "community edition" aesthetic; the design system must hold up on a hobbyist's VPS and in a paying org.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Dark theme must maintain ≥4.5:1 contrast for body text and code; never rely on color alone for sync/state indicators (import/mirror/cutover states pair color with icons and labels). Respect prefers-reduced-motion for all non-essential animation. Code views must support keyboard navigation and honor user font-size scaling without breaking layout.
