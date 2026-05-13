# Tessera Implementation Plan

## Context For Future Agents

This project was planned as a GitHub alternative with a narrower and more realistic wedge: open source Git hosting, repository browsing, pull requests, code review, and strong integrations.

Important source repositories to inspect before implementing:

- `/Users/mnigos/Documents/repositories/personal-apps/game-notes`
- `/Users/mnigos/Documents/repositories/rigtch/rigtch-fm`

Use `game-notes` as the primary reference for:

- DDD-style NestJS modules.
- API layering.
- oRPC contracts.
- Better Auth proxying through TanStack Start.
- Code style.
- Agent/Codex setup.
- UI package without Storybook.

Use `rigtch-fm` as the primary reference for:

- Redis.
- BullMQ.
- Storage package.
- Billing patterns.
- Dodo Payments patterns.
- CI.
- VS Code and Zed settings.
- Production infrastructure polish.

Do not commit unless explicitly asked.

## Current Scaffold State

Completed:

- Monorepo created at `/Users/mnigos/Documents/repositories/personal-apps/tessera`.
- `apps/web` TanStack Start app exists.
- `apps/api` NestJS API exists.
- `packages/auth` uses Better Auth.
- `packages/contracts` uses oRPC contracts.
- `packages/db` uses Drizzle and Postgres.
- `packages/domain` contains branded IDs and domain primitives.
- `packages/ui` copied from `game-notes`.
- Git repositories use filesystem-backed storage.
- `services/git` placeholder exists.
- GitHub social login configured in Better Auth.
- Web `/api/auth/*` proxy route preserved.
- Postgres, Redis, BullMQ, and S3-compatible storage setup exists.
- Docker Compose exists for API, Postgres, and Redis.
- Railway configs exist for API and web.
- Initial Drizzle migration generated.
- `SPEC.md`, `PLAN.md`, `PRODUCT.md`, `DESIGN.md`, `README.md`, and Railway docs exist.
- Storybook and Chromatic are intentionally not included.

Validation already run successfully:

```sh
bun run typecheck
bun run check
bun run test
bun run build
```

## Top-Level Architecture

Target monorepo structure:

```text
apps/
  web/
  api/

services/
  git/

packages/
  auth/
  contracts/
  db/
  domain/
  ui/
  storage/

tooling/
  typescript-config/
  tailwind-config/
```

No `ee/` directory exists yet. Enterprise Edition split is deferred.

## Implementation Rules

- Keep product app code in TypeScript.
- Keep Git storage/protocol service in Rust when that work begins.
- Keep NestJS API as the control plane.
- Keep Rust Git service focused on Git and storage.
- Do not duplicate authorization logic between TypeScript and Rust.
- Keep repository metadata in Postgres.
- Keep Git objects in bare repositories.
- Use opaque repository IDs for storage paths.
- Use owner slug and repository name for human-facing URLs.
- Avoid native issue tracker and CI/CD execution early.
- Avoid plugin marketplace early.
- Prefer integrations after core Git and PR workflow is valuable.

## Phase 0: Scaffold Hardening

Goal: make the scaffold easy for future agents and humans to run.

Tasks:

- Confirm `.env` files are examples or local-only and contain no real secrets.
- Consider adding `.env.example` files for API and web.
- Update README with setup commands.
- Document GitHub OAuth app setup.
- Document local Docker Compose setup.
- Document Railway setup.
- Add missing integration test config if `test:integration` remains in scripts.
- Decide whether `apps/api/Dockerfile` should remain or be simplified.
- Confirm CI works without Storybook/Chromatic.
- Confirm generated Drizzle migration is checked in.
- Confirm `services/git` placeholder is intentionally minimal.

Acceptance:

- Fresh clone can run `bun install`.
- Fresh clone can run `bun run typecheck`.
- Fresh clone can run `bun run test`.
- Fresh clone can run `bun run build`.
- Local Docker data services can start.
- README clearly explains GitHub OAuth env vars.

## Phase 1: Authentication And Profiles

Goal: working GitHub-only sign-in and profile shell.

Current state:

- Better Auth is configured for GitHub.
- Web app has sign-in/sign-out UI.
- Auth proxy exists at `/api/auth/*`.
- Profile page shell exists.

Tasks:

- Verify GitHub OAuth callback with real local credentials.
- Ensure callback URL works through the web proxy.
- Ensure API CORS and trusted origins work locally and on Railway.
- Add robust session endpoint tests.
- Normalize GitHub account data into Tessera user profile fields.
- Decide username source:
  - GitHub login if available.
  - fallback generated slug if unavailable.
- Add a profile route based on username later.
- Add avatar fallback handling.
- Add loading, authenticated, unauthenticated, and error UI states.

Acceptance:

- User can sign in with GitHub locally.
- User can sign out.
- Session survives reload.
- Signed-in user appears in nav.
- Profile shell renders signed-in user.

## Phase 2: Organizations

Goal: first-class organizations before adoption and integrations.

Data model:

- `organizations`
- `organization_members`
- roles: `owner`, `admin`, `member`

Tasks:

- Add organization creation.
- Add organization slug validation.
- Add organization profile page.
- Add organization list for viewer.
- Add organization settings page.
- Add member list.
- Add invite flow.
- Add role changes.
- Add leave organization flow.
- Add delete organization flow with guardrails.
- Add tests for organization permissions.

Questions:

- Whether to use Better Auth organization plugin immediately or keep current custom org tables.
- Whether org slugs should be immutable after creation.
- Whether user namespace and org namespace share a global slug namespace.

Recommendation:

- Keep custom repo-specific org/permission model for now.
- Consider Better Auth organization plugin only if it cleanly fits the desired UX.

Acceptance:

- User can create org.
- Org owner is created automatically.
- User can list orgs.
- Org can own repositories in later phases.

## Phase 3: Repository Metadata Core

Goal: create repositories in Postgres before real Git storage exists.

Data model:

- `repositories`
- owner user ID or owner organization ID.
- name.
- description.
- visibility.
- default branch.
- storage path.

Tasks:

- Add repository creation contract.
- Add repository creation service.
- Validate repository names using `REPOSITORY_NAME_REGEX`.
- Enforce unique repository names per owner.
- Add user-owned repositories.
- Add organization-owned repositories.
- Add repository list on profile page.
- Add repository list on organization page.
- Add repository settings shell.
- Add repository visibility update.
- Add delete repository metadata flow with confirmation.
- Add permission checks for create/update/delete.
- Add repository route shape:
  - `/:owner/:repo`
  - `/:owner/:repo/tree/:ref/*`
  - `/:owner/:repo/blob/:ref/*`

Acceptance:

- Signed-in user can create a metadata-only repo.
- User profile lists owned repositories.
- Repository page shell exists.
- Organization-owned repositories can be created if org phase is complete.

## Phase 4: Rust Git Service Skeleton

Goal: create a separate Rust service boundary before implementing Git protocols.

Service responsibilities:

- Own filesystem paths for bare repositories.
- Create bare repositories.
- Delete bare repositories.
- Read repository metadata from filesystem when requested.
- Call NestJS API for authorization.
- Emit events back to API.

Initial Rust stack to decide:

- HTTP framework: Axum is a strong default.
- Async runtime: Tokio.
- Serialization: Serde.
- Git operations: Git CLI first.
- Error handling: thiserror/anyhow depending on boundary.
- Tracing: tracing.

Initial API endpoints:

```http
POST /repos
DELETE /repos/:repoId
GET /repos/:repoId/readme?ref=main
GET /repos/:repoId/tree?ref=main&path=src
GET /repos/:repoId/blob?ref=main&path=src/main.rs
POST /repos/:repoId/compare
```

Internal API calls back to NestJS:

```http
POST /internal/git/authorize
POST /internal/git/events/push
GET /internal/git/repos/:repoId/storage
```

Tasks:

- Create Rust workspace under `services/git`.
- Add basic health endpoint.
- Add config/env parsing.
- Add structured logging.
- Add internal shared secret for API-to-git-service calls.
- Add Docker/Railway service config later.
- Add TypeScript API client for git-service.
- Add tests for path construction.
- Ensure all repo paths use opaque IDs, never user input paths.

Acceptance:

- Git service runs locally.
- API can call Git service health endpoint.
- Git service can create a bare repository in a configured local data directory.

## Phase 5: Bare Repository Storage

Goal: actual Git-backed repository creation and basic reads.

Storage path:

```text
/data/git/repositories/{repo_id}.git
```

Tasks:

- Add storage root config to Git service.
- Implement `git init --bare`.
- Implement delete with safe path checks.
- Implement repository existence checks.
- Implement default branch detection.
- Implement branch listing.
- Implement tag listing.
- Implement tree listing with `git ls-tree`.
- Implement blob reading with `git show`.
- Implement README discovery:
  - `README.md`
  - `README.markdown`
  - `README`
  - case-insensitive variants later.
- Implement file size limits for preview reads.
- Implement binary file detection.
- Add errors for empty repositories.
- Add process timeout handling.
- Add tests for path traversal attempts.

Acceptance:

- Creating a Tessera repo creates a bare Git repo.
- Empty repo page handles no commits.
- Seeded repo can return README.
- Seeded repo can return tree entries.
- Seeded repo can return a blob.

## Phase 6: Git HTTP Access

Goal: clone/fetch/push over HTTPS.

Approach:

- Do not implement Git protocol manually.
- Use Git's smart HTTP backend or a careful wrapper around it.
- Authenticate in Rust or at gateway boundary.
- Authorize via NestJS internal endpoint.

Tasks:

- Implement route for Git smart HTTP.
- Parse repo owner/name from Git URL.
- Resolve to repo ID through API.
- Authenticate request token/session.
- Authorize operation:
  - fetch/clone = read.
  - push = write.
- Run `git-http-backend` with controlled environment.
- Add pre-receive/update/post-receive hooks or equivalent event handling.
- Emit push events to API.
- Add audit log records.
- Add docs:
  - `git clone https://...`
  - `git remote add origin https://...`

Acceptance:

- User can clone a repo over HTTPS.
- User can push to a repo over HTTPS.
- Unauthorized user cannot read private repo.
- Unauthorized user cannot push.
- Push event appears in API logs/event table.

## Phase 7: Git SSH Access

Goal: clone/fetch/push over SSH.

Tasks:

- Add SSH public key model in API.
- Add SSH key management UI.
- Store key fingerprint.
- Determine if Rust service hosts SSH itself or uses forced-command integration.
- Implement public key lookup through API.
- Parse SSH Git command:
  - `git-upload-pack`
  - `git-receive-pack`
- Resolve repository.
- Authorize read/write through API.
- Run Git command with safe args.
- Add deploy keys later.
- Add audit logs.

Acceptance:

- User can add SSH key.
- User can clone over SSH.
- User can push over SSH.
- Unknown key is rejected.
- Known key without repo permission is rejected.

## Phase 8: Repository Browser

Goal: first strong user-facing Git browsing experience.

Tasks:

- Add repository page.
- Add empty repository state with clone/push instructions.
- Add README rendering.
- Add directory tree.
- Add breadcrumbs.
- Add branch selector.
- Add file row icons.
- Add file preview route.
- Add raw file route.
- Add copy raw URL button.
- Add syntax highlighting with Shiki.
- Add large file handling.
- Add binary file handling.
- Add markdown sanitization.
- Add commit short SHA display.

Acceptance:

- Pushed repository displays README first.
- Directory tree appears below or alongside README per final UI decision.
- User can click directories.
- User can view text files.
- Code is syntax-highlighted.

## Phase 9: Commit History

Goal: inspect repository history.

Tasks:

- Add commit list endpoint.
- Add commit detail endpoint.
- Add commit author/committer preservation.
- Add branch/tag refs UI.
- Add commit page with changed files.
- Add basic diff generation.
- Add pagination.

Acceptance:

- Repository shows recent commits.
- Commit detail page shows metadata and diff summary.

## Phase 10: Pull Request MVP

Goal: make Tessera usable for code collaboration.

Data model:

- pull requests.
- pull request commits snapshot or computed view.
- pull request events.
- pull request merge state.

Tasks:

- Add PR creation from source branch to target branch.
- Add branch compare endpoint.
- Add commits tab.
- Add files changed tab.
- Add unified diff view.
- Add PR title/body editing.
- Add open/closed/merged states.
- Add merge button.
- Implement merge commit path first.
- Record merge actor.
- Emit PR events.

Acceptance:

- User can open PR.
- User can view commits.
- User can view changed files.
- User can merge if allowed.

## Phase 11: Pull Request Merge Strategies

Goal: support expected GitHub-style merge ergonomics.

Tasks:

- Add squash merge.
- Add rebase merge.
- Add merge conflict detection.
- Add blocked merge states.
- Add required checks model.
- Add required approvals model.
- Add branch protection integration.

Acceptance:

- PR can merge with merge commit.
- PR can squash merge.
- PR can rebase merge.
- UI clearly explains blocked states.

## Phase 12: Code Review

Goal: make PRs genuinely useful.

Tasks:

- Add PR comments.
- Add inline diff comments.
- Add review threads.
- Add pending review state.
- Add approve/request changes/comment review outcomes.
- Add thread resolved/unresolved state.
- Add notifications.
- Add review activity timeline.

Acceptance:

- User can comment on PR.
- User can comment on a diff line.
- User can submit review.
- User can resolve thread.

## Phase 13: Checks And Statuses Model

Goal: prepare for CI integrations without building CI.

Data model:

- commit statuses.
- check suites/check runs maybe later.
- provider.
- state.
- target URL.
- timestamps.

Tasks:

- Add API for external status updates.
- Add webhook/token auth for providers.
- Show checks on commit and PR.
- Add required checks branch protection.
- Add status event audit logs.

Acceptance:

- External system can post commit status.
- PR page shows checks.
- Merge button respects required checks if configured.

## Phase 14: GitHub Import

Goal: reduce adoption friction.

Tasks:

- Connect GitHub OAuth or GitHub App.
- List accessible repositories.
- Select repositories to import.
- Create Tessera repository metadata.
- Mirror Git history.
- Preserve branches and tags.
- Preserve commit authors.
- Show import progress.
- Handle import failures.
- Add retry.

Acceptance:

- User can import a GitHub repo.
- Imported repo can be browsed in Tessera.

## Phase 15: GitHub Mirroring

Goal: let users try Tessera without immediately cutting over.

Tasks:

- Add external source metadata:
  - provider.
  - external repo URL.
  - external repo ID.
  - mirror mode.
- Implement one-way GitHub -> Tessera sync first.
- Add scheduled fetch.
- Add manual sync.
- Show mirrored state in UI.
- Handle conflicts and force pushes.

Acceptance:

- Tessera repo can stay synced from GitHub.
- UI clearly marks mirrored repositories.

## Phase 16: Migration And Cutover

Goal: make Tessera the source of truth.

Tasks:

- Generate remote switch commands.
- Add migration checklist.
- Add optional push mirror back to GitHub.
- Add docs for team migration.
- Add import of open PRs later.
- Add import of issues later only if needed.

Acceptance:

- User can switch local remote from GitHub to Tessera.
- Team can follow documented cutover path.

## Phase 17: Integration Framework

Goal: support providers without building a full marketplace.

Initial provider interface:

```ts
interface IntegrationProvider {
  id: string
  name: string
  category: 'ci' | 'issues' | 'ai' | 'chat' | 'deploy' | 'observability'
  install(ctx: unknown): Promise<void>
  uninstall(ctx: unknown): Promise<void>
  handleEvent(event: unknown): Promise<void>
  handleWebhook?(request: Request): Promise<Response>
}
```

Internal events:

- `repo.created`
- `repo.pushed`
- `commit.status_updated`
- `pull_request.opened`
- `pull_request.synchronized`
- `pull_request.merged`
- `review.submitted`
- `comment.created`

Tasks:

- Add integration installation model.
- Add provider registry.
- Add event bus abstraction.
- Add webhook receipt.
- Add retry/dead-letter behavior through queue.
- Add integration settings per org/repo.

Acceptance:

- Internal provider can subscribe to push/PR events.
- Failed provider calls are retried.

## Phase 18: CI/CD Integrations

Goal: integrate, do not compete.

Preferred first providers:

- Depot.
- Blacksmith.

Tasks:

- Add provider configuration.
- Trigger build on push/PR event.
- Receive status webhook.
- Update commit statuses.
- Link out to CI run.
- Show status in PR.

Acceptance:

- Depot or Blacksmith can run builds from Tessera events.
- Result appears as PR check.

## Phase 19: Issue Tracker Integrations

Goal: link code work to external planning tools.

Providers:

- Linear.
- Jira.
- ClickUp.

Tasks:

- Link org/repo to external project.
- Detect issue keys in branch names.
- Detect issue keys in commit messages.
- Detect issue keys in PR titles.
- Show linked issue sidebar.
- Move issue status on PR opened/merged if configured.
- Comment back on external issue with PR link if configured.

Acceptance:

- PR shows linked Linear/Jira/ClickUp issue.
- Merge can update issue state through provider.

## Phase 20: AI Coding Tool Integrations

Goal: make Tessera useful for modern AI-assisted coding workflows.

Potential integrations:

- Codex.
- Cursor.
- Claude Code.

Capabilities to expose:

- Repository context API.
- PR diff API.
- Review comment API.
- Branch creation API.
- Commit status/check API.
- "Open in Cursor" links.
- "Ask Codex to review" workflow.
- "Send PR to Claude Code" workflow.

Acceptance:

- AI tool can read PR context.
- AI tool can submit review/status/comment through scoped auth.

## Phase 21: Billing And Monetization

Goal: monetize hosted Tessera without undermining open source trust.

Provider direction:

- Dodo Payments is the likely first payment provider.
- Use `rigtch-fm` billing patterns as reference.

Principles:

- Billing code can be open source.
- Secrets stay in environment variables.
- Hosted SaaS can enforce entitlements.
- Self-hosters should not be burdened with hostile DRM.

Potential hosted entitlements:

- Private repo limits.
- Seat limits.
- Storage limits.
- Organization billing plans.
- Managed backups.
- Managed GitHub migration.
- Premium support.

Potential enterprise features later:

- SAML SSO.
- SCIM.
- Advanced audit logs.
- Advanced policy engine.
- HA storage.
- Advanced GitHub mirroring.

Tasks:

- Add billing schema only when plans are concrete.
- Add Dodo customer creation.
- Add checkout.
- Add billing portal.
- Add webhook verification.
- Add entitlement records.
- Add org-level billing.

Acceptance:

- Hosted org can subscribe.
- Entitlements update from signed Dodo webhooks.

## Phase 22: Open-Core Decision Point

Goal: decide whether an `ee/` directory is necessary.

Do not add `ee/` until there is a concrete paid feature that should be commercially licensed.

Possible future structure:

```text
ee/
  saml-sso/
  scim/
  advanced-audit/
  ha-storage/
  advanced-policies/
```

Decision criteria:

- Feature is mostly valuable to enterprises.
- Feature has meaningful support/compliance cost.
- Feature does not undermine trust if commercially licensed.
- Feature can be isolated without damaging architecture.

## Phase 23: Storage Scaling

Goal: move from single-node storage to serious hosted infrastructure.

Tasks:

- Add storage node model.
- Track capacity.
- Add placement strategy.
- Add repository backup jobs.
- Add restore workflow.
- Add repository size calculation.
- Add Git GC jobs.
- Add storage health checks.
- Add read replica/mirror strategy.
- Add disaster recovery docs.

Acceptance:

- Repositories can be assigned to storage nodes.
- Backup and restore work in staging.

## Phase 24: Security And Abuse Hardening

Goal: make source hosting trustworthy.

Tasks:

- Threat model Git HTTP.
- Threat model Git SSH.
- Threat model auth proxy.
- Threat model webhooks.
- Prevent path traversal by construction.
- Use argument arrays, never shell strings.
- Add Git command timeouts.
- Add request size limits.
- Add push size limits.
- Add file preview size limits.
- Add rate limits.
- Add audit logs.
- Add secret handling docs.
- Add dependency review.

Acceptance:

- Security-sensitive flows have tests.
- Git service path handling is fuzzed or property-tested.
- Unauthorized access tests exist for private repos.

## Phase 25: Documentation

Goal: make the project agent-friendly and contributor-friendly.

Docs to maintain:

- README.
- SPEC.
- PLAN.
- PRODUCT.
- DESIGN.
- Railway deployment docs.
- Local development docs.
- GitHub OAuth setup.
- Git service architecture.
- Git storage operations.
- Integration provider guide.
- Security model.
- Migration guide.

Acceptance:

- A new agent can pick up a phase from PLAN and understand context.
- A developer can run the app locally from README.
- Deployment docs match actual Railway config.

## Immediate Next Tasks

Recommended next sequence:

1. Add `.env.example` files.
2. Improve README setup instructions.
3. Verify GitHub OAuth flow locally.
4. Add repository creation endpoint and UI.
5. Add organization creation endpoint and UI.
6. Start Rust Git service skeleton.
7. Connect repository creation to bare Git repo creation.

## Verification Commands

Run after non-trivial changes:

```sh
bun run typecheck
bun run check
bun run test
bun run build
```

Run database generation after schema changes:

```sh
bun run db:generate
```

Run migrations locally when Postgres is available:

```sh
bun run db:migrate
```
