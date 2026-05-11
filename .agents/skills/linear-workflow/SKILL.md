---
name: linear-workflow
description: Linear MCP integration for fetching issues, projects, and managing tasks. Use when working with Linear task IDs (e.g., RIG-287), creating issues, or saving plans to Linear.
---

# Linear Workflow

## Task ID Format

All tasks use the `RIG-*` prefix (e.g., `RIG-287`).

## Core Rules

1. **ALWAYS assign to current user** when creating or updating issues — use `assignee: "me"`
2. **ALWAYS assign priority based on research** — evaluate impact, urgency, scope, blockers, and user value before choosing priority
3. **ALWAYS assign the proper project** when it can be identified from the request, parent issue, roadmap context, or existing Linear data
4. **ALWAYS write a real description** — describe the problem or feature idea clearly and include concrete acceptance criteria
5. **NEVER create new labels** — only use existing labels from the repository

## Fetching A Task (CRITICAL)

When given a Linear task ID, ALWAYS follow this sequence:

### Step 1: Get the issue with relations

```
mcp__linear-server__get_issue({ id: "RIG-287", includeRelations: true })
```

### Step 2: Get ALL comments

```
mcp__linear-server__list_comments({ issueId: "RIG-287" })
```

ALWAYS read all comments — they contain implementation plans, context, and requirements.

### Step 3: Fetch parent issue (if exists)

If the issue response contains a `parent` field, fetch the parent issue too:

```
mcp__linear-server__get_issue({ id: "<parent-id>", includeRelations: true })
mcp__linear-server__list_comments({ issueId: "<parent-id>" })
```

Parent issues often contain broader context, acceptance criteria, and architectural decisions that child tasks must follow.

### Step 4: Fetch project (if exists)

If the issue response contains a `project` field, fetch the project:

```
mcp__linear-server__get_project({ query: "<project-id-or-name>", includeMilestones: true })
```

Projects contain scope, milestones, and overall goals that inform implementation decisions.

### Summary

```
get_issue (with relations) + list_comments
  → if parent exists: get_issue (parent) + list_comments (parent)
  → if project exists: get_project (with milestones)
```

Run independent fetches in parallel when possible (e.g., parent issue + project fetch).

## Creating Issues And Feature Ideas

Before creating an issue, gather enough context to set the right assignee, priority, and project.

Minimum requirements for every new issue:

- Clear title with specific scope
- Detailed markdown description that explains the problem, feature idea, context, and expected outcome
- Acceptance criteria as a checklist
- `assignee: "me"`
- Priority selected from actual research, not guesswork
- Proper project assignment whenever one exists

Example:

```ts
mcp__linear-server__create_issue({
  title: "Add paid subscription status to profile header",
  team: "RIG",
  description: `## Summary

Show the user's paid subscription status in the profile header so premium access is visible immediately.

## Problem

Users and support currently need to open related screens to verify account state.

## Proposed Outcome

Display the current subscription state in the profile header with the correct label and fallback state.

## Acceptance Criteria

- [ ] Paid users see an active subscription badge
- [ ] Free users do not see premium-only UI
- [ ] Missing account data falls back safely
- [ ] Design matches the existing profile header patterns`,
  state: "todo",
  assignee: "me",
  priority: 2,
  project: "Paid Subscriptions",
})
```

Do not leave priority or project unset when the correct values can be determined from research.

## Starting Work On An Existing Issue

When implementing a Linear issue, ALWAYS do this before editing code:

1. Fetch the issue, comments, parent, and project context
2. Identify the target base branch:
   - use `main` when the work lands directly on main
   - use the relevant long-lived feature branch when the project uses one, e.g. `paid-subscriptions`
3. Checkout the target base branch and pull latest changes
4. Read the Linear branch name from the issue
5. Checkout that issue branch
6. Mark the Linear task as `in progress`
7. Start implementation

Example flow:

```bash
git checkout main
git pull --ff-only
git checkout <linear-branch-name>
```

Or for feature branch work:

```bash
git checkout paid-subscriptions
git pull --ff-only
git checkout <linear-branch-name>
```

Do not start implementing on a stale base branch.

## Saving Plans As Comments

After plan approval, save to the Linear task:

```
mcp__linear-server__create_comment({
  issueId: "RIG-287",
  body: "## Implementation Plan\n\n..."
})
```

Include ALL necessary context in the comment — the plan may be executed by a different agent session.

## Updating Issue Status

```
mcp__linear-server__update_issue({
  id: "RIG-287",
  state: "todo"       // or "in progress", "done", "canceled"
})
```

When beginning implementation for an active task, update the issue to `in progress` before making code changes.

## Pull Requests

When the user asks to create a PR:

1. If changes are not committed yet, review recent commit history first to understand scope and existing conventions
2. Split the work into multiple small, scoped commits when the diff contains more than one logical change
3. Push the branch
4. Create the PR
5. Write a human-readable PR description that explains either:
   - how the bug/problem was solved, or
   - how the new feature was implemented

The PR description should summarize behavior changes, important technical decisions, and any validation worth calling out.

## Rules

1. **ALWAYS fetch comments** — they are the primary source of plans and context
2. **ALWAYS check for parent issues and projects** — they provide broader context
3. **ALWAYS assign to current user** — use `assignee: "me"` when creating or updating
4. **ALWAYS research and set priority** — do not default blindly
5. **ALWAYS assign the right project** — infer from Linear/project context whenever possible
6. **ALWAYS add strong descriptions with acceptance criteria** for new issues and feature ideas
7. **ALWAYS checkout and update the correct base branch before implementation**
8. **ALWAYS mark the Linear task as `in progress` before coding**
9. **When creating a PR, prefer multiple small scoped commits over one large commit**
10. **NEVER create new labels** — only use existing labels from the repository
11. **NEVER skip parent/project fetch** — missing context leads to incorrect implementations
12. **Run parallel fetches** — parent issue + project can be fetched simultaneously
