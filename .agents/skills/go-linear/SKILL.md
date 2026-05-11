---
name: go-linear
description: Use when the user mentions a Tessera Linear ticket ID such as TES-123 and wants implementation started from that ticket.
---

# Go Linear

Use this skill to start implementation from a Linear issue.

Tessera Linear tickets use the `TES-*` prefix. Use the `tessera_linear` MCP server only.

## Required Related Skill

Use `linear-workflow` before implementation.

## Flow

1. Fetch the issue with relations.
2. Fetch all issue comments.
3. Fetch parent issue and parent comments when a parent exists.
4. Fetch project context when a project exists.
5. Identify relevant domain skills before editing.
6. Update the Linear issue status to `In Progress`.
7. Inspect the codebase and read at least 3 similar files before edits.
8. Implement the change, update tests when behavior changes, and run relevant checks.

## Rules

- Keep this workflow focused on the ticket and its comments.
- Do not rely on Claude-only agent orchestration.
- Do not create a branch unless the user or Linear workflow context explicitly requires it.
- Do not create commits, GitHub comments, or discussions unless explicitly asked.
- Keep plan files updated only when a plan file already exists or the user asks.
