---
document_id: TSR-8C2F74
title: Tessera Security, Availability, and Complexity Review
status: Final
reviewed_commit: 08c64de0fd1e5af96f3fd8b35bcb7885bd77d02a
review_date: 2026-08-11
review_method: Read-only source review with independent Opus consultation
companion_report: TSR-6DF6A1
---

# Tessera Security, Availability, and Complexity Review

Document ID: `TSR-8C2F74`

This report records the completed review conducted in a separate analysis thread. It is additive
to [`TSR-6DF6A1`](tessera-security-review-TSR-6DF6A1.md) and does not replace that report. The
review concentrated on exploitable security failures, availability boundaries, subprocess and
resource management, authorization, credentials, dependency reachability, and complexity that
creates concrete correctness risk.

## 1. Executive Summary

No confirmed remote code execution, direct authentication bypass, SQL injection, shell injection,
repository path traversal, stored cross-site scripting, or cross-repository IDOR was found in this
review.

The highest-priority risks are availability failures in the Git hosting plane:

1. Repository creation, import, push, SSH, and Git subprocess execution have no cohesive storage,
   byte, process, or concurrency quota.
2. Smart HTTP buffers complete clone responses and does not reliably terminate children after
   timeout or cancellation.
3. The installed gRPC JavaScript runtime has two network-triggerable crash advisories.
4. Public repository browsing and pull-request reads permit unbounded cardinality and work
   amplification.
5. Git subprocess policy is fragmented, causing timeouts that report failure while the underlying
   process continues mutating storage.

The codebase has strong path containment, authorization, webhook verification, output escaping,
and Git argument handling. The priority should therefore be to preserve those controls while
adding hard resource boundaries and consolidating process and RPC infrastructure.

## 2. Scope and Method

The review covered:

- The NestJS and oRPC API under `apps/api`.
- The TanStack Start web application and SSR request boundaries under `apps/web`.
- Better Auth configuration and GitHub OAuth integration under `packages/auth`.
- Drizzle schemas and repository access under `packages/db`.
- BullMQ-backed imports, GitHub synchronization, and pull-request workflows.
- The Rust Git gRPC, Smart HTTP, SSH, storage, browser, comparison, merge, and GPG paths.
- Runtime and transitive JavaScript and Rust dependency advisories.
- Deployment documentation relevant to internal RPC and credential boundaries.

The work combined manual source-to-sink review, authorization and trust-boundary tracing,
dependency reachability triage, targeted test and static-check execution, and an independent
read-only Claude Opus consultation. Consultant conclusions were treated as hypotheses and were
retained only where local code or installed dependency behavior supported them.

No `.env`, credential, private-key, deployment-secret, or other secret-bearing file was opened.
Codex Deep Security Scan was not run.

## 3. Priority Findings

### P0: Immediate Availability and Dependency Risk

#### TSR-8C2F74-01: Git hosting lacks storage and compute abuse controls

- Severity: High
- Confidence: High
- Preconditions: A GitHub-authenticated account for repository creation or writes; anonymous
  access is sufficient for some amplification after an attacker creates a public repository.

Evidence:

- [`RepositoriesService.create`](apps/api/src/modules/repositories/application/repositories.service.ts#L242)
  proceeds directly from authenticated input to database metadata and Git storage creation.
- [`request_handler.rs`](services/git/src/smart_http/http/request_handler.rs#L110) deliberately
  exempts `receive-pack` from the normal Smart HTTP request-body ceiling.
- [`github-import.processor.ts`](apps/api/src/modules/github-import/application/github-import.processor.ts#L61)
  requests a full mirror import without a repository-size preflight.
- [`repository_storage.rs`](services/git/src/storage/infrastructure/repository_storage.rs#L95)
  clones or fetches the complete mirror.
- [`server.rs`](services/git/src/ssh/infrastructure/server.rs#L136) accepts every SSH session
  channel, and the execution path has no global or per-user Git-process semaphore.
- No application-level repository-count, storage-byte, object-count, ref-count, disk, or aggregate
  Git-process quota was found. Existing API-key request limits do not bound bytes, disk, or process
  lifetime.

Impact:

A low-privilege user can exhaust persistent storage, inodes, CPU, memory, or process capacity using
large pushes, repeated imports, numerous repositories, or parallel SSH channels. Once a large
repository is public, anonymous reads can amplify the cost.

Remediation:

1. Enforce per-owner repository-count, storage-byte, object-count, and ref-count quotas.
2. Set `receive.maxInputSize` and reject oversized or unknown-length pushes at the transport edge.
3. Query GitHub repository size before scheduling an import and reserve quota atomically.
4. Add global, per-user, and per-repository semaphores for Git children and transport connections.
5. Apply container or service CPU, memory, process, file-descriptor, and disk limits.
6. Emit quota, saturation, and cleanup metrics with actionable alerts.

#### TSR-8C2F74-02: Smart HTTP buffers complete pack responses and has an incomplete deadline

- Severity: High
- Confidence: High
- Preconditions: Anonymous access to a sufficiently large public repository or an authenticated
  write with a slow request body.

Evidence:

- [`git_http_backend.rs`](services/git/src/smart_http/infrastructure/git_http_backend.rs#L88)
  spawns `git http-backend` without `kill_on_drop`.
- The request body is copied to child stdin before
  [`wait_with_output()`](services/git/src/smart_http/infrastructure/git_http_backend.rs#L90)
  begins.
- The 30-second timeout wraps only `wait_with_output()`, after request ingestion, at
  [`git_http_backend.rs`](services/git/src/smart_http/infrastructure/git_http_backend.rs#L103).
- `wait_with_output()` buffers the complete CGI response, which is then materialized as one HTTP
  body in [`request_handler.rs`](services/git/src/smart_http/http/request_handler.rs#L151).
- Tokio child processes continue after their handle is dropped unless `kill_on_drop` or explicit
  termination is configured.

Impact:

- Concurrent anonymous clones consume memory proportional to the sum of generated pack responses.
- The client receives no response bytes until Git exits.
- Slow uploads can hold a child outside the stated execution deadline.
- Timeout or client cancellation can leave Git running after Tessera reports failure.

Remediation:

1. Stream CGI stdout to the client with backpressure rather than using `wait_with_output()`.
2. Drain child stdout and stderr concurrently with request-body forwarding.
3. Apply one end-to-end deadline covering authorization, upload, Git execution, and response.
4. Kill and reap the child and its process group on timeout, body failure, or client cancellation.
5. Bound anonymous clone concurrency and output bytes.

#### TSR-8C2F74-03: Installed gRPC JavaScript runtime has reachable crash advisories

- Severity: High when the API gRPC listener is network-reachable; Medium when strictly isolated
- Confidence: High
- Affected version: `@grpc/grpc-js 1.14.3`

Evidence:

- [`apps/api/package.json`](apps/api/package.json#L24) permits the affected `1.14.3` release.
- [`apps/api/src/main.ts`](apps/api/src/main.ts#L32) starts a gRPC server.
- [GHSA-5375-pq7m-f5r2](https://github.com/advisories/GHSA-5375-pq7m-f5r2)
  documents a malformed HTTP/2 stream initiation that can crash a server.
- [GHSA-99f4-grh7-6pcq](https://github.com/advisories/GHSA-99f4-grh7-6pcq)
  documents malformed compressed messages that can crash clients or servers.
- Both advisories are fixed in `1.14.4` and occur below application bearer authorization.

Impact:

An unauthenticated party with network access to the gRPC listener can terminate the API process,
or crash a client using a malformed compressed response.

Remediation:

1. Upgrade `@grpc/grpc-js` to `1.14.4` or a later reviewed release.
2. Keep both internal gRPC listeners inaccessible from public networks.
3. Add a dependency regression check that fails on known runtime crash advisories.

### P1: Resource Amplification and Process Correctness

#### TSR-8C2F74-04: Public repository browsing performs unbounded work

- Severity: Medium-High availability
- Confidence: High
- Preconditions: An attacker can construct a public repository with high ref, tag, or tree
  cardinality and then issue anonymous requests.

Evidence:

- Public browser controllers accept an optional session in
  [`repository-browser.controller.ts`](apps/api/src/modules/repositories/presentation/repository-browser.controller.ts#L7).
- [`repository_browser.rs`](services/git/src/storage/infrastructure/repository_browser.rs#L86)
  runs `for-each-ref` across all heads and tags without a result or output cap.
- [`repository_refs_with_signatures`](services/git/src/storage/infrastructure/repository_browser.rs#L120)
  performs one sequential signature-verification subprocess per annotated tag.
- Root and nested tree reads buffer every `ls-tree` entry in
  [`repository_browser.rs`](services/git/src/storage/infrastructure/repository_browser.rs#L384).
- [`getBrowserSummary`](apps/api/src/modules/repositories/application/repositories.service.ts#L825)
  loads and verifies all refs merely to render the repository overview.

Impact:

One attacker-controlled repository can convert anonymous overview or tree requests into large Git
outputs, sequential process fan-out, memory allocation, gRPC messages, API transformation, SSR
work, and browser rendering.

Remediation:

1. Add hard limits and cursor pagination for refs and tree entries.
2. Return explicit truncation and continuation metadata.
3. Verify annotated-tag signatures on demand or cache immutable results by object ID.
4. Add Git output-byte limits and anonymous repository-browser rate limits.
5. Avoid listing every ref on the default overview path.

#### TSR-8C2F74-05: Timed-out storage commands continue running and mutating state

- Severity: Medium-High correctness and availability
- Confidence: High

Evidence:

- Mirror push wraps `Command::output()` in a timeout without `kill_on_drop` in
  [`repository_storage.rs`](services/git/src/storage/infrastructure/repository_storage.rs#L158).
- Repository initialization, clone, and fetch repeat the same pattern at
  [`repository_storage.rs`](services/git/src/storage/infrastructure/repository_storage.rs#L244),
  [`repository_storage.rs`](services/git/src/storage/infrastructure/repository_storage.rs#L270),
  and [`repository_storage.rs`](services/git/src/storage/infrastructure/repository_storage.rs#L310).
- Branch and symbolic-head helpers repeat it later in the same file.
- GPG-backed Git execution also wraps `command.output()` without child termination in
  [`repository_gpg.rs`](services/git/src/storage/infrastructure/repository_gpg.rs#L69).
- The browser implementation already demonstrates a safer centralized pattern with
  `kill_on_drop(true)` in
  [`repository_browser.rs`](services/git/src/storage/infrastructure/repository_browser.rs#L581).

Impact:

After an import or mirror job reports timeout and retries, the original child can still clone,
fetch, push, or update metadata. This permits overlapping repository mutations, hidden resource
consumption, stale temporary directories, and credentials remaining in a live child environment.

Remediation:

1. Route all Git and GPG subprocesses through one hardened executor.
2. Configure `kill_on_drop`, explicit kill, wait/reap, and process-group cleanup.
3. Include stdin writes and stdout/stderr draining within the same deadline.
4. Make import and mirror retries idempotent against still-running or partially completed work.
5. Test timeout, cancellation, broken-pipe, and retry overlap behavior.

#### TSR-8C2F74-06: Public pull-request collections are unbounded

- Severity: Medium availability
- Confidence: High

Evidence:

- [`listPullRequestsInputSchema`](packages/contracts/src/pull-requests.contract.ts#L819) has a state
  filter but no cursor or limit.
- [`PullRequestsRepository.list`](apps/api/src/modules/pull-requests/infrastructure/pull-requests.repository.ts#L317)
  returns every matching row.
- [`PullRequestsService.list`](apps/api/src/modules/pull-requests/application/pull-requests.service.ts#L249)
  enriches the complete result with Git head resolution, reviews, and checks.
- Timeline events have no result cap in
  [`pull-requests.repository.ts`](apps/api/src/modules/pull-requests/infrastructure/pull-requests.repository.ts#L410).
- Thread assembly loads all comments and performs `comments.filter` for every thread in
  [`pull-request-threads.repository.ts`](apps/api/src/modules/pull-requests/infrastructure/pull-request-threads.repository.ts#L712),
  producing O(threads × comments) application work.
- Read endpoints are available anonymously for public repositories in
  [`pull-requests.controller.ts`](apps/api/src/modules/pull-requests/presentation/pull-requests.controller.ts#L21).

Impact:

An attacker-owned repository or a large synchronized GitHub history can produce anonymous DB,
Git RPC, memory, serialization, response-size, and client-rendering amplification.

Remediation:

1. Add stable cursor pagination and hard page-size ceilings to PRs, threads, comments, checks, and
   timeline events.
2. Group comments once by thread ID or assemble them in SQL.
3. Fetch expensive review/check summaries only for the visible page.
4. Add query-cost and response-size tests for high-cardinality repositories.

#### TSR-8C2F74-07: Hono CORS middleware is vulnerable to preflight ReDoS

- Severity: Medium availability
- Confidence: High
- Affected version: `hono 4.12.18`

Evidence:

- [`apps/api/src/main.ts`](apps/api/src/main.ts#L26) enables CORS without a nonempty
  `allowHeaders` list.
- The installed Nest Hono adapter delegates this configuration to `hono/cors`.
- [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239)
  documents quadratic parsing of attacker-controlled `Access-Control-Request-Headers` in this
  default configuration. The issue is fixed in `4.12.34`.

Impact:

Repeated unauthenticated preflight requests can consume disproportionate CPU and stall request
processing.

Remediation:

1. Upgrade Hono to `4.12.34` or later.
2. Configure an explicit nonempty list of allowed request headers.
3. Apply edge header-size limits and regression-test hostile preflight values.

#### TSR-8C2F74-08: Internal RPC transport, credentials, and deadlines are under-hardened

- Severity: Medium, deployment-dependent
- Confidence: High for configuration; network exploitability depends on topology

Evidence:

- The Rust storage server configures no TLS in
  [`services/git/src/main.rs`](services/git/src/main.rs#L63).
- The Nest storage client configures no channel credentials in
  [`git-storage.module.ts`](apps/api/src/config/git-storage/git-storage.module.ts#L25).
- Smart HTTP authorization sends Git access credentials over this boundary in
  [`api_authorizer.rs`](services/git/src/smart_http/infrastructure/api_authorizer.rs#L51).
- Repository imports send a broad GitHub OAuth token to storage in
  [`git-storage.client.ts`](apps/api/src/config/git-storage/git-storage.client.ts#L137).
- Deployment guidance reuses one bearer token in both directions in
  [`railway-deployments.md`](docs/railway-deployments.md#L72).
- Twelve of fifteen API-to-storage `firstValueFrom` calls lack an RxJS deadline; only merge-related
  calls are bounded in
  [`git-storage.client.ts`](apps/api/src/config/git-storage/git-storage.client.ts#L390).
- The Smart HTTP authorization endpoint has no connect or operation deadline in
  [`api_authorizer.rs`](services/git/src/smart_http/infrastructure/api_authorizer.rs#L87), while
  the SSH authorizer applies one.

Impact:

If internal traffic crosses an unencrypted or insufficiently isolated network, an adjacent
attacker can observe or modify code, internal bearer tokens, Git access tokens, or GitHub OAuth
credentials. Independently, an unresponsive peer can hold public requests or jobs indefinitely.

Remediation:

1. Use TLS or mTLS, or enforce an encrypted service mesh and strict network policy.
2. Use independent, high-entropy, rotatable tokens for each communication direction.
3. Add mandatory per-operation deadlines and cancellation through shared client wrappers.
4. Validate endpoint schemes and reject plaintext cross-host deployment accidentally.
5. Avoid forwarding broad OAuth credentials when a short-lived installation token can be used.

#### TSR-8C2F74-09: Broad GitHub OAuth credentials are retained as plaintext application data

- Severity: Medium confidentiality
- Confidence: High

Evidence:

- [`packages/auth/server.ts`](packages/auth/server.ts#L110) requests GitHub's classic `repo` scope.
- GitHub documents that `repo` grants read and write access to public and private repositories and
  additional repository and organization resources.
- [`packages/db/schema/auth.schema.ts`](packages/db/schema/auth.schema.ts#L57) stores access,
  refresh, and ID tokens in ordinary text columns.
- [`github-import.repository.ts`](apps/api/src/modules/github-import/infrastructure/github-import.repository.ts#L66)
  reads the raw access token directly for import processing.

Impact:

Database, backup, or privileged read-replica compromise exposes third-party credentials whose
authority is substantially broader than one Tessera repository.

Remediation:

1. Prefer GitHub App installation tokens with short lifetime and repository-specific permission.
2. Request import authority only when needed rather than during every sign-in.
3. Envelope-encrypt retained OAuth credentials using a separately managed, rotatable key.
4. Design and test migration and rotation before enabling at-rest encryption.
5. Ensure logs, job payloads, exceptions, and observability never serialize the token.

### P2: Configuration and Data-Integrity Hardening

#### TSR-8C2F74-10: Production validation accepts a known short authentication secret

- Severity: At least Medium, deployment-dependent
- Confidence: High that the unsafe state is accepted

Evidence:

- [`env.schema.ts`](apps/api/src/config/env/env.schema.ts#L61) defaults `AUTH_SECRET` to the public
  value `development-auth-secret`.
- The production refinement at
  [`env.schema.ts`](apps/api/src/config/env/env.schema.ts#L88) enforces only the Git clone base
  URLs.
- [`auth.module.ts`](apps/api/src/modules/auth/auth.module.ts#L13) passes the resulting value to
  Better Auth.
- Parent-domain session cookies may be enabled automatically in
  [`packages/auth/server.ts`](packages/auth/server.ts#L73), expanding the blast radius of a weak
  signing boundary when sibling subdomains are not equally trusted.

Assessment:

The known value does not, by itself, mint an arbitrary normal session in the reviewed database-
backed configuration because the session token must also exist in the database. This review did
not dynamically exercise every Better Auth token-consuming route. The companion
[`TSR-6DF6A1`](tessera-security-review-TSR-6DF6A1.md) report documents a separate installed-route
analysis and assigns a higher conditional severity. This report does not supersede that finding.

Remediation:

1. Remove the fallback and reject missing, known, short, or low-entropy values in production.
2. Require at least 32 random bytes and store them only in the deployment secret manager.
3. Support deliberate rotation without continuing to trust the published development value.
4. Prefer host-only cookies where the deployment topology permits.
5. Add a production startup test for missing and weak authentication secrets.

#### TSR-8C2F74-11: User and organization handles can race into one namespace

- Severity: Low-Medium integrity
- Confidence: High

Evidence:

- Usernames and organization slugs are independently unique in their respective database tables.
- Cross-table checks in [`packages/auth/server.ts`](packages/auth/server.ts#L128) are explicitly
  application-level and identify the missing database guarantee.
- Repository lookup can match both namespaces and deliberately prioritizes the user in
  [`repositories.repository.ts`](apps/api/src/modules/repositories/infrastructure/repositories.repository.ts#L287).

Impact:

Concurrent first-user login and organization creation can both pass their pre-checks, producing
route shadowing or ambiguous ownership. No direct authorization bypass was demonstrated.

Remediation:

1. Introduce a shared handle-allocation table with one unique normalized handle.
2. Allocate and release handles in the same transaction as user or organization mutation.
3. If a shared table is deferred, serialize both paths with the same database advisory lock.
4. Add a concurrency test that races user and organization creation for the same handle.

## 4. Complexity and Maintainability Risks

### 4.1 Large API units concentrate unrelated invariants

The largest production files at the reviewed revision include:

| Component | Physical lines | Concentrated responsibilities |
| --- | ---: | --- |
| [`github-sync.repository.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync.repository.ts) | 2,120 | Leases, installations, deliveries, reconciliation, state transitions, and persistence. |
| [`pull-requests.service.ts`](apps/api/src/modules/pull-requests/application/pull-requests.service.ts) | 1,587 | PR lifecycle, comparisons, reviews, checks, merge decisions, and authorization orchestration. |
| [`github-sync-conversations.repository.ts`](apps/api/src/modules/github-sync/infrastructure/github-sync-conversations.repository.ts) | 1,545 | Threads, comments, reviews, provider mappings, and reconciliation. |
| [`pull-requests.repository.ts`](apps/api/src/modules/pull-requests/infrastructure/pull-requests.repository.ts) | 1,479 | Native PR persistence, events, provider reconciliation, and transactional mutation. |
| [`repositories.service.ts`](apps/api/src/modules/repositories/application/repositories.service.ts) | 1,421 | Lifecycle, storage, browser reads, authorization, import completion, mirroring, and synchronization health. |

Large files are not vulnerabilities by themselves. The observed consequences are repeated missing
pagination, expensive whole-collection enrichment, and difficulty auditing where authorization,
storage, provider, and transaction invariants begin and end.

Recommended direction:

1. Split repository lifecycle, browser, Git authorization, mirror, and synchronization-health
   application services behind a temporary facade.
2. Separate provider-neutral PR operations from GitHub reconciliation adapters.
3. Keep atomic lease and reconciliation transitions behind explicit transactional facades rather
   than splitting individual statements across services.
4. Establish reusable cursor-pagination and bounded-collection conventions in contracts and
   repositories.

### 4.2 Git subprocess policy is fragmented

Git children are created independently by storage, browser, comparison, GPG, Smart HTTP, SSH, and
push-event components. Their environment clearing, deadlines, output handling, cancellation,
termination, and error classification have already diverged. The timeout-without-kill finding is a
direct result.

Introduce a hardened `GitCommandRunner` responsible for:

- Repository path scoping.
- Sanitized environment and credential injection.
- Input, output, and error byte limits.
- End-to-end deadlines and cancellation.
- `kill_on_drop`, process-group kill, wait, and reap.
- Concurrency permits and structured metrics.

Keep Git result parsers feature-specific so the runner does not become another oversized domain
service.

### 4.3 Public read models need cost-aware boundaries

Repository summaries, refs, trees, PR lists, threads, checks, and timelines are composed as complete
collections. Several endpoints then enrich those collections with Git calls or nested filtering.
The contracts should make boundedness explicit through cursors, limits, truncation flags, and
stable ordering rather than relying on current dataset size.

### 4.4 RPC policy should be centralized

Smart HTTP and SSH maintain separate API authorization clients, while API-to-storage calls apply
timeouts selectively. Central clients should own endpoint validation, transport credentials,
deadlines, cancellation, status mapping, and redacted telemetry. Protocol error codes should replace
matching human-readable messages.

## 5. Dependency Triage

`bun audit` reported 88 raw advisory entries: 2 Critical, 37 High, 40 Medium, and 9 Low. Raw counts
were not treated as counts of exploitable application defects.

Confirmed reachable runtime items:

- `@grpc/grpc-js 1.14.3`: two client/server crash advisories, fixed in `1.14.4`.
- `hono 4.12.18`: CORS preflight header parsing ReDoS, fixed in `4.12.34`.

Downranked or rejected items:

- Better Auth Critical and High advisories targeting email/password, device authorization, OIDC
  provider, OAuth provider, magic-link, OTP, MCP, anonymous, admin, or SCIM plugins were not
  promoted where those features were not enabled. This does not remove the need for an upgrade.
- `srvx 0.10.1` is affected by an absolute-request-URI middleware-bypass advisory, but this review
  found no web authorization boundary that depends on the affected middleware path.
- `@hono/node-server` Windows path traversal and WebSocket memory issues did not match the reviewed
  Linux and non-WebSocket production path.
- Vite, Turbo, tar, and PostCSS advisories were primarily development or build-surface issues.

`cargo audit` reported the RSA Marvin timing advisory through `russh`, an `anyhow` proc-macro/build
warning, and yanked `aes` and `spin` releases. Tessera defaults to an Ed25519 SSH host key, and this
review found no default RSA private-key decryption operation, so the Marvin issue was retained as an
upstream tracking item rather than a confirmed exploit path.

## 6. Strong Existing Controls

The following controls were verified and should be preserved:

- Repository storage paths are derived from strict UUID identities, revalidated, canonicalized,
  and checked against symlink escape.
- Git commands use argument arrays instead of shells; refs and object IDs are allow-listed and
  `--end-of-options` is used on sensitive resolution paths.
- Private and nonexistent repositories deliberately produce indistinguishable not-found behavior.
- Controller guards are backed by service-level repository and pull-request context validation.
- GitHub webhook signatures use HMAC-SHA256 and timing-safe comparison and fail closed when the
  secret is absent.
- Check-output URLs are restricted to HTTP(S), and source-highlighting text is escaped before raw
  HTML rendering.
- Raw blobs have an explicit size ceiling, are served as `application/octet-stream`, and the Node
  gRPC receive limit is aligned with the blob limit.
- Better Auth API-key management routes are explicitly locked down, and Git/check-status keys use
  scoped configurations and request limits.
- Pull-request merge paths use expected SHAs, leases, operation receipts, and transactional
  constraints.

## 7. Verification

| Check | Result |
| --- | --- |
| `bun run typecheck` | Passed across 10 tasks. |
| `bun run check` | Passed across 850 checked files without fixes. |
| Web unit tests | Passed: 43 files and 404 tests after supplying safe command-local Git base URLs. |
| API unit tests | Two time-dependent assertions failed in `github-sync.processor.spec.ts`; their fixed reset timestamp was already in the past. |
| `cargo test -p tessera-git` | Passed: 254 Rust tests across unit and integration targets. |
| `cargo clippy -p tessera-git --all-targets -- -D warnings` | Failed on 10 existing Clippy findings, plus two test-literal escape diagnostics. |
| `bun audit` | Reported 88 raw advisories; reachability was triaged as described above. |
| `cargo audit` | Reported the conditional RSA advisory, a build-path warning, and yanked dependencies. |
| Git worktree after review | Clean. |

The top-level test command initially failed because the web test environment lacked
`VITE_PUBLIC_GIT_HTTP_BASE_URL` and `VITE_PUBLIC_GIT_SSH_BASE_URL`. The isolated web suite passed
with safe localhost values. The two API failures are at
[`github-sync.processor.spec.ts`](apps/api/src/modules/github-sync/application/github-sync.processor.spec.ts#L411)
and [`github-sync.processor.spec.ts`](apps/api/src/modules/github-sync/application/github-sync.processor.spec.ts#L865).
They should use a fake clock or relative future reset rather than a calendar date.

Database-backed integration tests and full browser and Git E2E suites were not run because the
required database and supporting service stack was not started for this read-only review.

## 8. Prioritized Remediation Plan

### Immediate

1. Upgrade `@grpc/grpc-js` to at least `1.14.4` and Hono to at least `4.12.34`.
2. Enforce a strong explicit production `AUTH_SECRET`; reconcile this action with companion report
   `TSR-6DF6A1`.
3. Put repository, storage, pack, object, process, and connection quotas in front of Git writes and
   imports.

### Next 48 Hours

1. Add global and per-principal Git concurrency semaphores.
2. Set receive-pack input limits and reject imports that cannot reserve quota.
3. Add explicit deadlines to every internal RPC and the Smart HTTP authorizer.
4. Kill and reap every timed-out or cancelled Git/GPG child.
5. Restrict internal gRPC listeners through network policy while TLS or mTLS is designed.

### Next Sprint

1. Stream Smart HTTP responses with concurrent pipe draining and end-to-end cancellation.
2. Add cursor pagination for refs, trees, PRs, threads, comments, checks, and events.
3. Create the shared `GitCommandRunner` and shared internal authorization client.
4. Migrate GitHub imports toward short-lived installation tokens and design token encryption.
5. Add high-cardinality and resource-limit regression tests.
6. Split the largest repository, pull-request, and synchronization units along transactional and
   use-case boundaries.

## 9. Limitations

- Live production secrets, configuration, network topology, service-mesh encryption, edge limits,
  logs, databases, backups, queues, repositories, and runtime metrics were not inspected.
- No `.env`, credential, private-key, or secret file was opened.
- Codex Deep Security Scan was not run.
- No destructive, production-facing, or resource-exhaustion proof of concept was attempted.
- Database-backed integration and full E2E suites were not executed.
- Dependency advisory status can change after the review date.
- Static source review cannot prove the absence of every vulnerability.
- The review was performed at commit `08c64de0fd1e5af96f3fd8b35bcb7885bd77d02a`.
- This report is an independent additive review. Where the companion
  [`TSR-6DF6A1`](tessera-security-review-TSR-6DF6A1.md) report contains a deeper route-specific,
  dependency-specific, or dynamically reproduced analysis, that evidence should be considered
  alongside this report rather than replaced by it.
