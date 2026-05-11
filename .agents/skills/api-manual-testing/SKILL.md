---
name: api-manual-testing
description: Manual API QA workflow for creating and running curl-based endpoint test plans from Linear tickets, contracts, or endpoint requirements.
---

Use this skill when creating manual API test plans, running curl checks against the local API, translating Linear tickets or endpoint requirements into flows, or reporting pass/fail API QA results.

## First Read

Before testing, read:
- This skill.
- Related contract files in `packages/contracts/src/`.
- Relevant API controller and service files.
- Existing integration tests for comparable endpoint behavior.
- Any auth, route, seed, or setup helper whose current behavior you are not already certain about.

Confirm route shape, request schema, response schema, and local API config from live files before writing commands.

## Workflow

- Fetch the Linear task only when an ID is provided and the Linear tools are available.
- Identify endpoints from contracts and controllers.
- Confirm whether endpoints require auth before running requests.
- Confirm the local API is running before curl execution.
- Verify any seed script path before presenting it as canonical.
- Run flows locally unless the user explicitly asks for parallel agent work.
- Use subagents only when the user explicitly asks for subagents, delegation, or parallel agent work.

## Flow Design

- Start with auth/session setup when endpoints require sessions.
- Group tests by user journey or resource workflow.
- Cover success, unauthorized, forbidden, not found, conflict, bad request, and validation cases when relevant.
- Include race conditions or ordering checks only when the feature implies them.
- Clean up test data when the flow creates persistent records.

## Curl Rules

- Use the confirmed base URL and route shape.
- Use cookies or headers that match current auth behavior.
- Check both status code and response body.
- Use `jq` when it makes response assertions clearer.
- Keep commands reproducible and avoid secrets.

```bash
curl -s -o /tmp/response.json -w "%{http_code}" http://localhost:4000/health/ping
```

## Output

Provide a concise plan or results table with:
- Flow name.
- Endpoint and method.
- Expected status.
- Actual status.
- Body summary for failures.
- Pass/fail status.

For failures, report the exact endpoint, status, and a short body summary.

## Verification

- Confirm local API is running before curl execution.
- Use current contracts for request and response shape.
- Report exact endpoint, status, and body summary for failures.
