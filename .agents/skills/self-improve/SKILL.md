---
name: self-improve
description: Use when the user corrects agent behavior and wants repo instructions, skills, prompts, or workflow rules updated so the mistake is less likely to happen again.
---

# Self Improve

Use this skill to turn a user correction into a narrow, durable instruction update.

## Flow

1. Identify each mistake, correction, or preference from the conversation.
2. Classify the affected domain: API, frontend, database, testing, git workflow, Linear, docs, or general agent behavior.
3. Read relevant existing skills, `AGENTS.md`, `CLAUDE.md`, and nearby rule docs before editing.
4. If API behavior is involved, inspect `apps/api/docs/guidelines/README.md` and the relevant files in `apps/api/docs/guidelines/` when they exist.
5. Decide whether each correction is a recurring rule, a one-off preference, or already covered.
6. Update the narrowest useful instruction surface.
7. Summarize what changed and why.

## Rules

- Do not add broad global rules for one-off incidents.
- Prefer updating a domain skill over `AGENTS.md` when the rule is domain-specific.
- Keep wording short, concrete, and agent-actionable.
- Do not create commits, branches, GitHub comments, or discussions unless explicitly asked.
- Before editing any instruction or skill file, read at least 3 similar files.
