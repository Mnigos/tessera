---
name: coordinator-mode
description: Coordinate multi-agent work with explicit delegation, ownership, re-delegation, review, and verification. Use when the user asks to use subagents, coordinate agents, act as an agents' coordinator, swarm, delegate, or split work across agents.
---

# Coordinator Mode

Use this skill when the user wants agent coordination rather than a single-agent implementation sprint.

## Role

The coordinator owns decomposition, context packets, sequencing, integration review, and final verification.

Worker agents own most file reading and editing for their assigned write sets.

## Workflow

1. Intake task, constraints, dirty files, required skills, and affected domains.
2. Split work into research, implementation, tests, and review.
3. Assign each worker a bounded write set, acceptance criteria, relevant docs, skills to read, and validation command.
4. Keep an owner map so two workers do not edit the same files unless explicitly sequenced.
5. Re-delegate when dependencies appear. If a test worker is blocked because implementation files do not exist yet, re-engage after they do.
6. Review worker diffs with targeted reads and tests. Do not redo worker research broadly.
7. Use `review_gate` after non-trivial changes and wait for it unless it is clearly stuck.
8. Before final verification, scan the full working tree for inline review/action markers. Treat explicit action markers such as `REVIEW:`, `TODO:`, `FIXME:`, `BUG:`, `HACK:`, and `XXX:` as real markers; ignore ordinary words such as `preview`. If the marker belongs to an active worker's write set, send it back to that worker. Otherwise choose the domain skill by path first (`apps/web` -> `web-app-patterns`, `apps/api` -> `api-patterns`, `services/git` -> `rust-service-patterns`), then by language fallback.
9. Run final verification and report worker outcomes, tests, and any skipped checks.

## Coordinator Limits

- Do not become primary implementer by default.
- Read only enough code to route work, verify results, and resolve integration conflicts.
- If you edit files locally, keep edits small and explain why.
- The worker that edits files must satisfy skill usage and similar-file reading rules for those files.
- Prefer sending failing commands, stack traces, DB/test state, and suspected ownership area back to the owning worker before patching locally.
- Worker prompts must explicitly tell workers not to leave `//REVIEW:`, `TODO`, `FIXME`, or similar action markers in code unless the user asked for a tracked marker.

## Worker Prompt Packet

```md
Task:
Acceptance criteria:
Relevant docs/issues:
Required skills:
Write ownership:
Read before editing:
Do not touch:
Validation commands:
Known environment notes:
Return:
- changed files
- tests run
- blockers
- follow-up needed
```

## API Integration Example

For backend API tasks with integration coverage:

- `repo_researcher`: research contracts, modules, similar specs, integration helpers, and return an assignment map.
- `backend_engineer`: implement contracts, module, controller, service, repository, and focused unit tests in the assigned backend write set.
- `test_engineer`: add unit and integration coverage after implementation files exist.
- Coordinator: run typecheck, check:fix, focused tests, integration tests, and final diff review.
- `review_gate`: check behavior, missing tests, contract drift, and rule violations before completion.
