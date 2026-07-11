---
name: coordinator-mode
description: Coordinate complex work through explicit workstreams, integration review, verification, and an independent review gate. Use when the user asks for coordinated execution, staged ownership, or review-gated delivery.
---

# Coordinator Mode

Use this skill when the user wants coordinated execution with an independent final review.

## Role

The main agent owns decomposition, research, implementation, tests, integration, and final verification. The `review_gate` subagent owns the independent final defect review.

## Workflow

1. Intake task, constraints, dirty files, required skills, and affected domains.
2. Split work into research, implementation, tests, integration, and review workstreams.
3. Execute each workstream locally using its matching domain skills and live repo patterns.
4. Keep file ownership and sequencing explicit so coupled changes remain coherent.
5. Run focused checks as each workstream lands, then review the integrated diff.
6. Before final verification, scan the full working tree for `REVIEW:`, `TODO:`, `FIXME:`, `BUG:`, `HACK:`, and `XXX:` markers.
7. Use `review_gate` after non-trivial changes and wait for it unless it is clearly stuck.
8. Fix valid review findings, rerun affected checks, then run final verification.
9. Report changed behavior, review outcome, tests, and skipped checks.

## Coordinator Limits

- Do not spawn subagents other than `review_gate`.
- The main agent must satisfy skill usage and similar-file reading rules for every edited file.
- Keep workstreams bounded and finish focused validation before final review.
- Do not leave action markers unless the user explicitly requested one.
- Treat `review_gate` findings as hypotheses: verify each one, fix valid issues only, then rerun affected checks.
