---
document_id: TSR-C4A7F2
title: Tessera Security, Reliability, and Complexity Review
status: Final
reviewed_commit: 810dd86be4a59cb03532871ceaf003d604eec46f
review_date: 2026-08-11
target_branch: t3code/tessera-security-review-TSR-6DF6A1
pull_request: 120
review_method: standard-static-review
codex_deep_security_scan: false
---

# Tessera Security, Reliability, and Complexity Review

Document ID: `TSR-C4A7F2`

This report preserves
[`tessera-security-review-TSR-6DF6A1.md`](tessera-security-review-TSR-6DF6A1.md) as a historical
review. It supersedes only the following conflicting dispositions from that document:

- The known `AUTH_SECRET` fallback is High, not Conditional Critical, because exploitation still
  depends on an omitted deployment variable whose live state was not inspected.
- `russh 0.60.3` was not retained as a reportable advisory finding after the current review matched
  the installed version and enabled behavior against the advisories it validated.
- Hono CORS parsing is Medium; cross-tab query caching, the exposed Vite development server, and
  the Docker context issue are Low under their documented prerequisites.

All non-conflicting evidence and recommendations in the historical report remain independent
review material.

## 1. Executive Summary

This repository-wide, read-only review validated 14 security findings: 2 High, 9 Medium, and
3 Low. It also confirmed five reliability defects and four architectural complexity themes that
should be planned alongside the security work.

The two highest-priority risks are:

1. A known fallback `AUTH_SECRET` can enable account takeover when a deployment omits the
   variable. Better Auth's mounted verification route accepts a secret-signed change-email token,
   can create a database-backed victim session, updates the victim email, and emits the session
   cookie.
2. GitHub App installation events resolve repository sources globally without Tessera tenant or
   installation-account ownership. A valid webhook can therefore associate another party's
   installation with a former collaborator's imported repository and expose later private commits.

The main availability theme is missing resource governance around authentication bodies, Git pack
streaming, pushes, SSH child processes, and internal RPC deadlines. The main architectural theme is
that provider synchronization, leases, persistence, and cross-service orchestration are concentrated
in a few very large classes, making fencing and compensation failures harder to prevent.

No credible SQL injection, shell injection, repository path traversal, stored XSS, or direct
repository authorization bypass was validated. Several dependency audit matches were rejected
because their affected plugins, routes, protocol features, platforms, or versions were not used.

## 2. Scope and Method

Reviewed surfaces included:

- API authentication, authorization, contracts, controllers, repositories, queues, and gRPC clients.
- Web authentication proxying, private query caching, SSR boundaries, and repository UI data flows.
- GitHub OAuth, App installation association, webhooks, imports, leases, and reconciliation.
- Rust Smart HTTP, SSH, gRPC authorization, Git subprocesses, repository browsing, and storage.
- Database schemas and cross-service consistency boundaries.
- Dependency lockfiles, Docker context, deployment descriptors, and GitHub Actions.

The workflow used focused delegated reviewers, direct source-to-sink validation, installed dependency
inspection for reachable paths, an adversarial Claude Opus consultation, and an independent final
review gate. Opus recommendations were treated as consultant input rather than authority; two
path-confusion false negatives were rejected after direct source inspection proved the actual paths.

Codex Deep Security Scan was not used. No secret values, `.env` contents, credentials, or private
keys were inspected or recorded.

## 3. Priority Overview

| ID | Priority | Severity | Finding |
| --- | --- | --- | --- |
| TSR-C4A7F2-01 | P0 | High | Known fallback authentication secret can enable account takeover. |
| TSR-C4A7F2-02 | P0 | High | GitHub App installation binding can cross Tessera tenant boundaries. |
| TSR-C4A7F2-03 | P1 | Medium | Hono CORS preflight parsing is vulnerable to quadratic CPU work. |
| TSR-C4A7F2-04 | P1 | Medium | Better Auth requests bypass the platform body-size limit. |
| TSR-C4A7F2-05 | P1 | Medium | Smart HTTP buffers complete Git pack responses. |
| TSR-C4A7F2-06 | P1 | Medium | Git pushes lack byte, idle, storage, and operation quotas. |
| TSR-C4A7F2-07 | P1 | Medium | SSH permits unbounded channels and Git child processes. |
| TSR-C4A7F2-08 | P1 | Medium | GitHub synchronization side effects can outlive lease authority. |
| TSR-C4A7F2-09 | P1 | Medium | Broad GitHub OAuth tokens lack application-layer encryption. |
| TSR-C4A7F2-10 | P1 | Medium | `grpc-js` transport parsing can crash the shared API process. |
| TSR-C4A7F2-11 | P1 | Medium | A mutable privileged GitHub Action receives secrets and write/OIDC access. |
| TSR-C4A7F2-12 | P2 | Low | Private query data can survive a cross-tab account transition. |
| TSR-C4A7F2-13 | P2 | Low | The affected Vite development WebSocket binds to all interfaces. |
| TSR-C4A7F2-14 | P2 | Low | Docker builds copy an unrestricted root context without `.dockerignore`. |

## 4. Prioritized Security Findings

### TSR-C4A7F2-01: Known fallback authentication secret can enable account takeover

- Priority: P0
- Severity: High
- Confidence: High
- Preconditions: A deployment omits `AUTH_SECRET`, and the attacker knows the victim email.

Evidence:

- [`apps/api/src/config/env/env.schema.ts`](apps/api/src/config/env/env.schema.ts) defaults the
  secret to the public string `development-auth-secret`.
- [`apps/api/src/modules/auth/auth.module.ts`](apps/api/src/modules/auth/auth.module.ts) passes
  that value into the shared auth configuration.
- [`packages/auth/server.ts`](packages/auth/server.ts) supplies it as Better Auth's signing
  secret.
- The locally mounted Better Auth handler exposes `GET /api/auth/verify-email`. The installed route
  verifies HS256 tokens using the application secret, accepts `email`, `updateTo`, and
  `requestType`, and its `change-email-verification` branch can update the located user, create a
  session without an existing session, and set its cookie.

Impact:

An unauthenticated attacker can replace a victim's email and receive a real victim session,
exposing the victim's repositories, organizations, and linked integrations. The finding is
conditional because live deployment variables were not inspected.

Remediation:

1. Remove the default and require at least 32 random bytes at startup.
2. Keep any development fallback behind an explicit non-production configuration path.
3. Disable unused email-verification and change-email routes where supported.
4. If fallback use is possible, rotate the secret, invalidate sessions and verification tokens,
   and audit user-email changes and session creation.
5. Add a production configuration test covering missing, short, and known fallback values.

### TSR-C4A7F2-02: GitHub App installation binding can cross tenant boundaries

- Priority: P0
- Severity: High
- Confidence: High
- Preconditions: A former collaborator has an imported private repository, later loses direct
  GitHub access, and another valid installation includes the same provider repository.

Evidence:

- [`packages/db/schema/repository-external-sources.schema.ts`](packages/db/schema/repository-external-sources.schema.ts)
  does not make the provider numeric repository ID globally unique.
- [`apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts)
  performs a global provider-ID lookup followed by `limit(1)` without Tessera owner or
  installation-account scope.
- The installation-repository path repeats the same global lookup at
  [`github-sync.repository.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts)
  and writes the webhook's installation ID into the selected source.
- [`apps/api/src/modules/repositories/application/repositories.service.ts`](apps/api/src/modules/repositories/application/repositories.service.ts)
  validates local ownership and the presence of an installation, but not that the installation
  belongs to the same Tessera ownership context.

Impact:

The former collaborator can receive commits made after their GitHub access was revoked. The HMAC
validated webhook is authentic, but it does not establish which Tessera tenant owns the provider
installation authority.

Remediation:

1. Persist the installation account and Tessera owner explicitly.
2. Resolve sources through a unique installation, owner, and provider-repository tuple.
3. Revalidate provider access before mirror enablement and every synchronization claim.
4. Either reject duplicate imports globally or tenant-scope repository, PR, event, and actor
   mappings consistently.
5. Migrate existing ambiguous mappings deterministically and test historical-collaborator cases.

### TSR-C4A7F2-03: Hono CORS preflights reach a vulnerable parser

- Priority: P1
- Severity: Medium
- Confidence: High

Evidence:

- [`apps/api/src/main.ts`](apps/api/src/main.ts) installs CORS globally without a fixed
  `allowHeaders` list.
- [`bun.lock`](bun.lock) resolves Hono `4.12.18`, affected by
  `GHSA-8j4g-w8fx-2239`.
- Public `OPTIONS` requests control `Access-Control-Request-Headers` before route authentication.

Impact:

Crafted preflights can cause super-linear CPU work on the API event loop. The final gate calibrated
this to Medium because the upstream advisory is moderate and deployment header limits may bound
individual requests.

Remediation:

- Upgrade Hono to at least `4.12.34`.
- Configure a fixed allowed-header list.
- Enforce total and per-header limits at ingress and retain a regression test for the advisory
  payload.

### TSR-C4A7F2-04: Better Auth requests bypass the platform body-size limit

- Priority: P1
- Severity: Medium
- Confidence: High

Evidence:

- [`apps/api/src/main.ts`](apps/api/src/main.ts) skips parsing for `/api/auth`.
- [`apps/api/src/modules/auth/auth.module.ts`](apps/api/src/modules/auth/auth.module.ts) also
  disables the Nest auth parser and mounts the raw request handler.
- [`apps/web/src/modules/auth/routes/api.auth.$.route.ts`](apps/web/src/modules/auth/routes/api.auth.$.route.ts)
  forwards the request body without an independent cumulative cap.
- The adapter's normal 1 MiB limit is skipped, while the downstream body readers can buffer JSON,
  form, text, and binary input.

Impact:

Anonymous oversized or slow authentication requests can consume API or web-process memory and
parsing CPU. Request-count rate limits do not bound the cost of one request.

Remediation:

- Add byte-counting middleware before Better Auth and at the web proxy.
- Enforce limits for both `Content-Length` and chunked requests.
- Apply idle and end-to-end deadlines plus independent rate and concurrency controls.
- Test oversized JSON, multipart, text, and chunked requests at both boundaries.

### TSR-C4A7F2-05: Smart HTTP buffers complete Git pack responses

- Priority: P1
- Severity: Medium
- Confidence: High

Evidence:

- [`services/git/src/smart_http/infrastructure/git_http_backend.rs`](services/git/src/smart_http/infrastructure/git_http_backend.rs)
  calls `wait_with_output()`, buffering all Git CGI stdout.
- [`services/git/src/smart_http/application/smart_http.rs`](services/git/src/smart_http/application/smart_http.rs)
  models the response body as `Bytes`.
- [`services/git/src/smart_http/http/request_handler.rs`](services/git/src/smart_http/http/request_handler.rs)
  constructs the outgoing body only after buffering completes.

Impact:

Anonymous clones of public repositories can make the service hold complete packfiles in memory.
Concurrent large clones can exhaust memory and Git child capacity.

Remediation:

- Stream CGI headers and pack bytes with backpressure.
- Add output-size and clone-concurrency budgets.
- Kill and reap the child when the client disconnects or a deadline expires.
- Load-test large and concurrent public clones under a constrained memory limit.

### TSR-C4A7F2-06: Git pushes lack byte, idle, storage, and operation quotas

- Priority: P1
- Severity: Medium
- Confidence: High
- Preconditions: Authenticated write access to at least one repository.

Evidence:

- [`services/git/src/smart_http/http/request_handler.rs`](services/git/src/smart_http/http/request_handler.rs)
  authorizes receive-pack but deliberately bypasses the 16 MiB read-body cap.
- [`services/git/src/smart_http/infrastructure/git_http_backend.rs`](services/git/src/smart_http/infrastructure/git_http_backend.rs)
  writes every frame to child stdin without counting bytes or enforcing an idle deadline.
- The 30-second timeout begins only after request EOF.
- No repository, user, or platform storage quota was found.

Impact:

A normal repository writer can keep tasks and Git children occupied or exhaust shared disk by
pushing to a repository they control.

Remediation:

- Enforce upload, repository, user, and platform storage quotas.
- Start idle and total deadlines before the first request byte.
- Count chunked input instead of trusting `Content-Length`.
- Kill and reap Git on limit, cancellation, disconnect, or timeout.

### TSR-C4A7F2-07: SSH permits unbounded channels and Git child processes

- Priority: P1
- Severity: Medium
- Confidence: High
- Preconditions: A valid accepted SSH identity.

Evidence:

- [`services/git/src/ssh/infrastructure/server.rs`](services/git/src/ssh/infrastructure/server.rs)
  accepts every session channel.
- Each exec request spawns a Git process plus reader and waiter tasks without per-user,
  per-connection, or global admission limits.
- [`services/git/src/ssh/infrastructure/git_ssh_backend.rs`](services/git/src/ssh/infrastructure/git_ssh_backend.rs)
  configures no execution deadline or kill-on-drop behavior.

Impact:

One authenticated client can exhaust processes, file descriptors, memory, or CPU and affect other
tenants. Reusing a channel can also replace the tracked stdin handle without terminating an earlier
child.

Remediation:

- Add global, per-user, and per-connection semaphores.
- Limit channels and exec requests and reject channel reuse.
- Add idle and total deadlines.
- Explicitly kill and reap every child on disconnect and cancellation.

### TSR-C4A7F2-08: Synchronization side effects can outlive lease authority

- Priority: P1
- Severity: Medium
- Confidence: High

Evidence:

- [`apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts)
  permits lease takeover after expiration.
- [`apps/api/src/modules/github-sync/application/github-sync.processor.ts`](apps/api/src/modules/github-sync/application/github-sync.processor.ts)
  performs Git import and later PR reconciliation between discrete heartbeats.
- [`apps/api/src/modules/pull-requests/application/pull-requests.service.ts`](apps/api/src/modules/pull-requests/application/pull-requests.service.ts)
  does not receive a lease epoch or authority generation for each provider mutation.
- Finalization is fenced, but prior filesystem and database side effects are not all fenced.

Impact:

A stale worker can mutate refs or overwrite newer provider state after another worker acquires the
lease. Advisory locks serialize PR updates but do not make an older snapshot lose to a newer one.

Remediation:

- Renew the lease throughout the full claim and cancel immediately on renewal failure.
- Increment a monotonic fencing epoch per claim and require it on every mutation.
- Reject older `providerUpdatedAt` values.
- Serialize Git imports per repository and publish refs only after a final fence check.

### TSR-C4A7F2-09: Broad GitHub OAuth tokens lack application-layer encryption

- Priority: P1
- Severity: Medium
- Confidence: High
- Preconditions: Database, backup, replica, or equivalent read access.

Evidence:

- [`packages/auth/server.ts`](packages/auth/server.ts) requests classic GitHub `repo` scope.
- [`packages/db/schema/auth.schema.ts`](packages/db/schema/auth.schema.ts) stores access,
  refresh, and ID tokens in text columns.
- [`apps/api/src/modules/github-import/infrastructure/github-import.repository.ts`](apps/api/src/modules/github-import/infrastructure/github-import.repository.ts)
  reads the stored bearer token directly.
- Better Auth's OAuth token-encryption option is not enabled.

Impact:

A Tessera database disclosure becomes an external GitHub compromise affecting private repositories.

Remediation:

- Enable application-layer OAuth token encryption with a separately managed key.
- Migrate existing rows before changing consumers and rotate credentials where warranted.
- Minimize scopes and prefer short-lived GitHub App installation tokens for repository operations.
- Verify decrypted tokens never enter logs or error payloads.

### TSR-C4A7F2-10: `grpc-js` parsing can crash the shared API before authentication

- Priority: P1
- Severity: Medium
- Confidence: High
- Preconditions: TCP reachability to the private API gRPC listener.

Evidence:

- [`apps/api/src/main.ts`](apps/api/src/main.ts) starts a `grpc-js`-backed microservice in the
  same process as the public HTTP API.
- [`bun.lock`](bun.lock) resolves `@grpc/grpc-js 1.14.3`, affected by
  `GHSA-5375-pq7m-f5r2` and `GHSA-99f4-grh7-6pcq`.
- [`apps/api/src/modules/repositories/presentation/internal-git-authorization.guard.ts`](apps/api/src/modules/repositories/presentation/internal-git-authorization.guard.ts)
  authenticates only after transport parsing.

Impact:

A private-network peer can terminate the shared API process before the internal bearer guard runs.
Defaults and deployment guidance keep this listener private, so Internet exposure was not assumed.

Remediation:

- Upgrade `@grpc/grpc-js` to at least `1.14.4`.
- Bind the listener narrowly and verify it is excluded from public ingress.
- Add service-network policy or mTLS where supported.
- Retain regression tests for both malformed transport cases.

### TSR-C4A7F2-11: A mutable privileged GitHub Action receives secrets and write access

- Priority: P1
- Severity: Medium
- Confidence: High

Evidence:

- [`.github/workflows/claude.yml`](.github/workflows/claude.yml) grants contents, issues,
  pull requests, repository projects, and OIDC write permissions.
- The same job executes `anthropics/claude-code-action@beta` and supplies a Claude OAuth token.
- [`.github/workflows/main.yml`](.github/workflows/main.yml) also uses
  `actions/checkout@master`.
- [`.github/actions/setup/action.yml`](.github/actions/setup/action.yml) uses a mutable major
  setup action tag.

Impact:

If an upstream ref is maliciously moved or compromised, a subsequent workflow run can modify the
repository, exfiltrate credentials, and mint an OIDC token. No current upstream compromise was
found, and OIDC permission alone does not prove an accepting cloud trust policy.

Remediation:

- Pin every third-party action to a reviewed full commit SHA.
- Minimize job permissions and remove `id-token: write` unless required.
- Put write and OIDC operations behind actor-association checks or protected environments.
- Add a policy check rejecting movable action references.

### TSR-C4A7F2-12: Private query data can survive a cross-tab account transition

- Priority: P2
- Severity: Low
- Confidence: High

Evidence:

- [`apps/web/src/modules/auth/hooks/use-auth.ts`](apps/web/src/modules/auth/hooks/use-auth.ts)
  invalidates only the session query after logout.
- [`apps/web/src/router.tsx`](apps/web/src/router.tsx) keeps one `QueryClient` for the document.
- Private endpoint keys do not contain the authenticated user identity.

Impact:

If a shared browser changes from user A to user B while another tab survives, that tab can briefly
render A's cached repository, import, and credential metadata. Normal same-tab OAuth navigation
reconstructs the cache, which is why the finding is Low.

Remediation:

- Include user identity or an authentication epoch in every private query key.
- Remove private queries synchronously on logout and identity transition.
- Broadcast cache resets across tabs and gate rendering on a freshly confirmed session.

### TSR-C4A7F2-13: The affected Vite development WebSocket binds to all interfaces

- Priority: P2
- Severity: Low
- Confidence: High

Evidence:

- [`apps/web/vite.config.ts`](apps/web/vite.config.ts) binds the development server to
  `0.0.0.0` and leaves WebSocket/HMR enabled.
- [`package.json`](package.json) resolves Vite `8.0.2`, affected by
  `GHSA-p9ff-h696-f583`.
- [`apps/web/package.json`](apps/web/package.json) runs generated Nitro output in production,
  not the Vite development server.

Impact:

A LAN, VPN, or forwarded-port peer can read files available to a running developer process. This
does not establish a production exposure.

Remediation:

- Upgrade Vite to at least `8.0.5`.
- Bind development to loopback by default and require explicit opt-in for wider exposure.
- Disable WebSocket/HMR on network-exposed runs if an immediate upgrade is impossible.

### TSR-C4A7F2-14: Docker builds copy an unrestricted root context

- Priority: P2
- Severity: Low
- Confidence: High

Evidence:

- [`docker-compose.yml`](docker-compose.yml) uses the repository root as build context.
- [`apps/api/Dockerfile`](apps/api/Dockerfile) uses `COPY . .` in both development and
  production stages.
- [`.gitignore`](.gitignore) lists `.env` variants and key files, but no applicable root
  `.dockerignore` exists.

Impact:

If local ignored secret files are present, Docker copies them into image layers and cache. Exposure
requires building from such a workspace and sharing the image or cache. The documented Railway path
uses Railpack, so this is local-build and alternate-pipeline hardening.

Remediation:

- Add a root `.dockerignore` covering `.git`, `.env*`, keys, `node_modules`, Rust targets, build
  outputs, caches, tests, reports, and local data.
- Prefer allowlisted `COPY` operations and a minimal runtime stage.
- Add a sentinel test proving ignored files do not appear in any image layer.

## 5. Reliability and Correctness Issues

### 5.1 GitHub import retry can report `pending` without runnable work

- [`apps/api/src/modules/github-import/infrastructure/github-import.queue.ts`](apps/api/src/modules/github-import/infrastructure/github-import.queue.ts)
  uses the stable import ID as the BullMQ job ID.
- [`apps/api/src/config/queue/queue.module.ts`](apps/api/src/config/queue/queue.module.ts)
  retains the latest 100 completed jobs.
- [`apps/api/src/modules/github-import/application/github-import.processor.ts`](apps/api/src/modules/github-import/application/github-import.processor.ts)
  marks several terminal application failures and returns, so BullMQ records the job as completed.
- [`apps/api/src/modules/github-import/application/github-import.service.ts`](apps/api/src/modules/github-import/application/github-import.service.ts)
  resets the database row and adds the same job ID. BullMQ returns the retained terminal job rather
  than adding new runnable work.

The import remains `pending` until the retained job is eventually evicted, and another retry is
rejected because only failed rows are retryable. Use an attempt-generation job ID, remove a terminal
job before resetting state, or use an outbox that atomically proves runnable work exists.

### 5.2 Initial GitHub synchronization replays uncheckpointed history

[`apps/api/src/modules/github-sync/infrastructure/github-sync.client.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync.client.ts)
paginates every PR during initial synchronization and performs an extra detail request for every
merged PR. The cursor is persisted only after all Git import and PR reconciliation succeeds. Any
transient or poison-record failure restarts the full history scan, consuming installation API budget
and worker capacity.

Persist resumable page or entity checkpoints, separate ref import from PR backfill, isolate per-PR
failures, and apply bounded retry budgets.

### 5.3 A nullable merge SHA can poison reconciliation

[`apps/api/src/modules/github-sync/infrastructure/github-sync.client.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync.client.ts)
accepts a merged GitHub PR whose `merge_commit_sha` is null, then maps it to local `merged` state.
[`packages/db/schema/pull-requests.schema.ts`](packages/db/schema/pull-requests.schema.ts)
requires every merged row to have a merge SHA. One valid provider record can therefore abort the
repository sync and trigger the uncheckpointed replay behavior.

Represent this provider state explicitly as incomplete/pending, defer only that PR, and let the
remaining reconciliation and checkpoint advance.

### 5.4 Repository creation can orphan Git storage

[`apps/api/src/modules/repositories/application/repositories.service.ts`](apps/api/src/modules/repositories/application/repositories.service.ts)
creates database metadata, creates Git storage, and then updates the database storage path. If the
last database operation fails after storage succeeds, cleanup deletes metadata only. The Git storage
protocol has no compensating delete operation.

Add an idempotent delete-storage RPC or durable orphan sweeper and record a recoverable saga state
before crossing the service boundary.

### 5.5 Internal gRPC calls lack consistent deadlines

Most methods in
[`apps/api/src/config/git-storage/git-storage.client.ts`](apps/api/src/config/git-storage/git-storage.client.ts)
can wait indefinitely; merge is the exception. Smart HTTP authorization in
[`services/git/src/smart_http/infrastructure/api_authorizer.rs`](services/git/src/smart_http/infrastructure/api_authorizer.rs)
also lacks the five-second timeout used by SSH authorization.

Define shared connect, request, and total-operation deadlines, propagate cancellation, and map
deadline failures consistently across TypeScript and Rust clients.

## 6. Complexity and Maintainability

### 6.1 Four central files contain 4,469 production lines

| Component | Lines | Concentrated responsibilities |
| --- | ---: | --- |
| [`GitHubSyncRepository`](apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts) | 1,237 | Webhook deliveries, installation association, leases, scheduling, authority, and synchronization state. |
| [`RepositoriesRepository`](apps/api/src/modules/repositories/infrastructure/repositories.repository.ts) | 1,191 | Repository persistence, collaborators, organization access, imports, mirroring, and provider state. |
| [`RepositoriesService`](apps/api/src/modules/repositories/application/repositories.service.ts) | 1,137 | Lifecycle, authorization, import, browser, Git access, storage, and mirror orchestration. |
| [`PullRequestsRepository`](apps/api/src/modules/pull-requests/infrastructure/pull-requests.repository.ts) | 904 | Native PR lifecycle, provider mappings, actors, events, and reconciliation. |

The transactional portions should remain cohesive, but query construction, provider mapping,
lease state, lifecycle orchestration, and read models can be separated behind a narrow transactional
facade. This reduces the chance that a new write bypasses an authority or lease predicate.

### 6.2 Git child-process policy is duplicated and inconsistent

Smart HTTP, SSH, repository storage, browser, comparison, merge, and GPG paths each construct or
supervise Git processes. Timeout placement, kill-on-drop, output limits, cancellation, environment,
and error mapping differ by path.

Introduce a shared hardened Git process supervisor that owns:

- sanitized environment and argument boundaries;
- global and per-tenant admission limits;
- concurrent stdin/stdout/stderr draining;
- output, idle, and total-operation limits;
- cancellation, process-group kill, and reap behavior; and
- typed error and telemetry mapping.

### 6.3 Cross-service workflows lack one compensation model

Repository creation, GitHub import, Git storage, database state, and queue dispatch form distributed
sagas, but each feature handles compensation differently. The orphan-storage and retained-job retry
defects are two results of the same missing invariant: a returned success state must prove both
durable state and executable continuation.

Use explicit saga/outbox states, idempotent commands, reconciliation sweepers, and integration tests
for failures at every boundary.

### 6.4 Provider identity and local ownership are conflated

Provider repository IDs are global, while Tessera repositories and owners are tenant-scoped. The
schema and synchronization code mix these identity models, producing both the cross-tenant security
finding and duplicate-import correctness failures.

Choose one explicit model: globally unique provider sources with controlled tenant projections, or
fully tenant-scoped provider mappings. Encode the decision with database constraints rather than
unordered application lookups.

## 7. Strong Existing Controls

- Repository mutations use service-layer role checks in addition to controller guards.
- Private and nonexistent repositories intentionally share not-found behavior.
- Git repository paths are UUID-derived and protected by canonical containment and symlink checks.
- Git commands avoid shell evaluation and validate refs and object IDs.
- GitHub webhook signatures use HMAC-SHA256 with timing-safe comparison.
- Webhook delivery IDs, leases, advisory locks, and compare-and-set updates provide meaningful
  idempotency and concurrency protection, although fencing is incomplete.
- SSR creates a separate QueryClient per request.
- GPG verification uses isolated homes.
- Pull-request merge uses expected SHAs, leases, and database constraints.

## 8. Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | Passed across all workspace tasks. |
| `bun run check` | Passed across 562 files without fixes. |
| `bun run test` | Passed, including 538 API tests across 72 files. |
| `cargo test -p tessera-git` | Passed 153 Rust unit and integration tests. |
| Dependency reachability review | Hono, `grpc-js`, and Vite paths accepted; plugin-, protocol-, platform-, or build-only matches rejected where unreachable. |
| Final review gate | Completed; Hono was calibrated to Medium and shared-browser, Vite-dev, and Docker-context findings to Low. |
| Source worktree | Clean after the completed read-only review. |

The Rust `target/` build cache was removed with `cargo clean` after verification to recover disk
space. It contained only reproducible build artifacts.

## 9. Recommended Remediation Order

### Immediate

1. Verify every deployment supplies a strong `AUTH_SECRET`; remove the fallback and rotate if its
   use cannot be excluded.
2. Replace global GitHub source association with tenant- and installation-scoped ownership.
3. Upgrade Hono and `grpc-js`; upgrade Vite in the same dependency pass.

### Next

4. Add Smart HTTP streaming, push/storage quotas, SSH process admission, and end-to-end deadlines.
5. Add an authority fencing epoch to every GitHub sync side effect.
6. Encrypt and migrate GitHub OAuth tokens and reduce their scope.
7. Pin third-party GitHub Actions and reduce workflow permissions.

### Following Sprint

8. Repair BullMQ import retry identity and initial-sync checkpointing.
9. Normalize nullable provider data before persistence.
10. Add storage compensation or an orphan sweeper.
11. Split the central API repositories and services behind transactional facades.
12. Centralize Git child-process and gRPC deadline policy.

## 10. Limitations

- Live deployment variables, secret values, logs, databases, Redis, GitHub installations, network
  policy, ingress limits, filesystem quotas, images, and registries were not inspected.
- No destructive exploit, denial-of-service, or production-facing load test was performed.
- The `AUTH_SECRET` takeover requires a deployment that omitted or retained the known fallback.
- The gRPC crash findings require reachability to an intended private listener.
- The Vite finding applies to a reachable development server, not the production Nitro runtime.
- Docker leakage requires sensitive local files and a shared image or build cache.
- The query-cache issue requires a shared browser and a surviving or restored document.
- Dependency advisory status and fixed versions can change after the review date.
- Static review cannot prove the absence of every vulnerability. Findings record the strongest
  evidence-backed paths and reviewed counterevidence available at commit
  `810dd86be4a59cb03532871ceaf003d604eec46f`.
