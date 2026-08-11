---
document_id: TSR-6DF6A1
title: Tessera Security and Architecture Review
status: Final
reviewed_commit: 810dd86
review_date: 2026-08-11
---

# Tessera Security and Architecture Review

Document ID: `TSR-6DF6A1`

## 1. Executive Summary

This read-only review identified one conditional Critical account-takeover path, several High
availability risks, and material operational and architectural debt. No credible remote code
execution, SQL injection, shell injection, path traversal, server-side request forgery, stored
cross-site scripting, or direct repository-authorization bypass was found.

The most urgent finding is the known fallback value for `AUTH_SECRET`. If a deployment omits
the variable, Better Auth receives a publicly known signing secret. In the installed Better Auth
version, the email-verification flow can use a valid secret-signed change-email token to create a
real database session and update the target account. This is a conditional Critical issue: the
code permits the unsafe state, but the review did not inspect deployment secrets and therefore
cannot determine whether a live environment currently uses the fallback.

The public SSH listener also uses `russh 0.60.3`, which is affected by multiple remotely
reachable server-side denial-of-service and channel-state advisories. The combined minimum safe
version is `0.62.5`; `0.62.6` was current at the time of review.

The highest-value remediation order is:

1. Verify and rotate `AUTH_SECRET`, remove its fallback, and audit potentially affected accounts.
2. Upgrade `russh` to `0.62.6` or later.
3. Bound authentication bodies, syntax highlighting, Git transport, refs, trees, processes, and
   repository storage.
4. Centralize Git child-process lifecycle and enforce kill, reap, timeout, and output policies.
5. Encrypt and migrate broad GitHub OAuth tokens.
6. Correct production packaging so deployments run the built artifact with a minimal runtime.
7. Apply the remaining dependency, cache, RPC, import, CI, and infrastructure hardening.
8. Split the largest API and Git infrastructure responsibilities along the boundaries described
   in this report.

## 2. Scope and Methodology

The review covered:

- The NestJS API and Better Auth integration under `apps/api` and `packages/auth`.
- Database schemas, repositories, and transaction boundaries under `packages/db` and `apps/api`.
- The TanStack Start web application, SSR behavior, client caching, and raw HTML boundaries.
- The Rust Git service, including Smart HTTP, SSH, gRPC, filesystem containment, Git subprocesses,
  repository browsing, comparison, merge, GPG, and configuration.
- Contracts, generated gRPC boundaries, deployment files, containers, GitHub Actions, manifests,
  lockfiles, and relevant tests.

The workflow used nine specialist subagent passes in waves, two independent Opus consultations,
manual source-to-sink tracing, dependency-advisory reachability analysis, targeted dynamic
measurement of the syntax-highlighting path, and an independent final review gate. Consultant
claims were treated as hypotheses and corrected where local source or current advisories
contradicted them.

The Codex deep security scan feature was not used. No `.env`, credential, private-key, or secret
file was opened. This was a repository review, not a live production or infrastructure
assessment.

## 3. Severity and Confidence Model

| Rating | Meaning |
| --- | --- |
| Critical | A practical path to broad account, data, or system compromise. A conditional Critical rating means the impact is Critical when the stated deployment precondition is true. |
| High | A remotely reachable or low-effort path to major availability, confidentiality, or integrity impact. |
| Medium | Material impact with stronger preconditions, bounded scope, or deployment-dependent reachability. |
| Low | Defense-in-depth, local/shared-device, development-only, or maintainability concern with limited immediate security impact. |

Confidence is based on source reachability, enabled configuration, installed dependency behavior,
counterevidence, and whether the behavior was dynamically reproduced. Deployment-dependent
findings are explicitly marked because network topology, edge limits, and live secret values were
outside the review scope.

## 4. Priority Findings

### P0: Immediate Response

#### TSR-01: Known fallback authentication secret can enable account takeover

- Severity: Conditional Critical
- Confidence: High
- Affected components: API environment validation and Better Auth core routes
- Preconditions: A deployed API omits `AUTH_SECRET`, and an attacker knows the target account's
  email address.

Evidence:

- [`apps/api/src/config/env/env.schema.ts`](apps/api/src/config/env/env.schema.ts#L27) silently
  defaults `AUTH_SECRET` to `development-auth-secret`.
- [`apps/api/src/modules/auth/auth.module.ts`](apps/api/src/modules/auth/auth.module.ts#L13) passes
  that value into the shared Better Auth configuration.
- [`packages/auth/server.ts`](packages/auth/server.ts#L87) passes it as Better Auth's application
  secret.
- Better Auth `1.6.9` always registers `GET /verify-email`. The installed implementation verifies
  an HS256 token with the application secret. Its change-email verification branch can locate the
  target by email, create a database session when no session exists, update the email, mark it
  verified, and set the newly created session cookie.
- Better Auth only rejects its own different built-in default in production. Tessera's fallback is
  nonempty and merely produces low-length or low-entropy warnings, so startup continues.

Impact:

If a production environment uses the fallback, a valid secret-signed change-email verification
can take over a known account. This is not ordinary offline cookie forgery: Better Auth's normal
session cookie contains a random token that must exist in the database. The vulnerable route is
more consequential because it creates that valid database session itself.

Existing controls and limitations:

- Production documentation lists `AUTH_SECRET` as required.
- The review did not inspect live deployment variables, so it cannot assert that production uses
  the fallback.
- The attacker needs the target email. Emails can nevertheless be known externally or exposed in
  ordinary Git metadata and identity workflows.

Remediation:

1. Verify every deployed environment has an explicit `AUTH_SECRET` now.
2. Remove the default and require at least 32 random bytes at startup.
3. Generate a value with `openssl rand -hex 32`, store it in the deployment secret manager, and
   never commit it.
4. Do not retain the known fallback as an accepted rotation key.
5. If any environment may have used the fallback, rotate it, invalidate sessions, and audit
   unexpected user-email changes and newly created sessions.
6. Upgrade Better Auth and disable unused email-verification or change-email behavior where
   possible.
7. Add a production-config test proving startup fails when `AUTH_SECRET` is missing or weak.

#### TSR-02: Public SSH server uses a vulnerable `russh` release

- Severity: High
- Confidence: High
- Affected components: Rust SSH listener and `russh 0.60.3`
- Preconditions: Network access to the SSH listener; several paths require no authentication.

Evidence:

- [`services/git/Cargo.toml`](services/git/Cargo.toml#L17) declares `russh = "0.60.3"`.
- [`Cargo.lock`](Cargo.lock#L2083) locks `russh 0.60.3`.
- [`services/git/src/config.rs`](services/git/src/config.rs#L8) binds Git HTTP and SSH to `::` by
  default.
- [`services/git/src/main.rs`](services/git/src/main.rs#L38) uses `russh::server::Config` defaults
  except for the host key.

Applicable advisories:

| Advisory | Local reachability | Patched version |
| --- | --- | --- |
| [GHSA-4r3c-5hpg-58qr](https://github.com/advisories/GHSA-4r3c-5hpg-58qr) | Initial key exchange reaches allocation-first parsing before authentication. | `0.61.0` |
| [GHSA-76r6-x97p-67vr](https://github.com/advisories/GHSA-76r6-x97p-67vr) | Public clients can hold setup resources with unbounded pre-banner input. | `0.61.0` |
| [GHSA-wwx6-x28x-8259](https://github.com/advisories/GHSA-wwx6-x28x-8259) | Default server negotiation permits compression and post-decompression oversized packets. | `0.61.1` |
| [GHSA-5xvq-cp9x-6p6r](https://github.com/advisories/GHSA-5xvq-cp9x-6p6r) | Default Curve25519 key exchange permits a pre-authentication connection-task panic. | `0.62.4` |
| [GHSA-cqjc-rmpq-xprq](https://github.com/advisories/GHSA-cqjc-rmpq-xprq) | An authenticated SSH user can trigger a PTY parsing panic before Tessera's handler. | `0.62.4` |
| [GHSA-m65r-rprj-r5rg](https://github.com/advisories/GHSA-m65r-rprj-r5rg) | Authenticated channel requests can reach `exec_request` without an established channel, causing subprocess amplification. | `0.62.5` |

Impact:

The cluster includes remotely reachable memory pressure, long-lived pre-authentication resources,
compressed-packet amplification, connection-task panics, and authenticated Git subprocess
amplification. The individual panic paths are not remote code execution and are normally
connection-contained, but the allocation and compression advisories can threaten the service.

Remediation:

1. Change the manifest and lockfile to `russh 0.62.6` or a later reviewed release. Updating only
   the lockfile cannot escape the current `0.60.x` semver range.
2. Add SSH connection and handshake concurrency limits.
3. Reduce the default inactivity window and enforce limits that trickle traffic cannot extend
   indefinitely.
4. Add regression tests for malformed pre-authentication traffic and channel lifecycle handling.

### P1: High-Value Remediation

#### TSR-03: Git transport has compounding resource-exhaustion paths

- Severity: High
- Confidence: High
- Affected components: Smart HTTP, SSH, Git subprocess execution, refs, trees, and repository
  storage
- Preconditions: Anonymous reads of a sufficiently large public repository or authenticated Git
  writes.

Evidence:

- [`services/git/src/smart_http/infrastructure/git_http_backend.rs`](services/git/src/smart_http/infrastructure/git_http_backend.rs#L66)
  writes the complete request body to `git http-backend` before draining stdout.
- The same method starts its 30-second timeout only after request-body ingestion and uses
  `wait_with_output()`, which buffers the complete CGI response.
- [`services/git/src/smart_http/http/request_handler.rs`](services/git/src/smart_http/http/request_handler.rs#L110)
  bypasses the normal Smart HTTP body limit for receive-pack.
- [`services/git/src/smart_http/http/request_handler.rs`](services/git/src/smart_http/http/request_handler.rs#L151)
  materializes the buffered response as one body.
- [`services/git/src/storage/infrastructure/repository_browser.rs`](services/git/src/storage/infrastructure/repository_browser.rs#L579)
  wraps `Command::output()` in a timeout without configuring child termination.
- Similar timeout-without-kill patterns occur throughout
  [`repository_storage.rs`](services/git/src/storage/infrastructure/repository_storage.rs#L175)
  and the GPG path.
- Ref and tree APIs have no cursor or hard result cap. Annotated tags can cause one signature
  verification subprocess per tag.
- No global connection, Git-child, public-clone, or repository-storage quota was found.

Impact:

- Anonymous clones of public repositories can allocate memory proportional to the pack response.
- Large authenticated pushes can consume unbounded input, disk, and child-process time.
- Sequential stdin and stdout handling creates pipe-backpressure and deadlock risk.
- Dropping Tokio process futures does not kill or reap children unless explicitly configured.
- Unbounded refs, tree entries, and signature subprocesses amplify CPU, memory, gRPC, API, SSR,
  and browser work.

Remediation:

1. Stream Git request and response bodies while draining child pipes concurrently.
2. Apply an end-to-end deadline that includes upload time and client cancellation.
3. Explicitly kill and reap timed-out children and their process groups.
4. Add global and per-repository child-process and connection semaphores.
5. Enforce push, repository, object, ref, tag, and disk quotas.
6. Paginate refs and trees and return explicit truncation metadata.
7. Cache or batch tag-signature verification instead of spawning one process per tag.
8. Add load tests at and beyond every cap.

#### TSR-04: Public syntax highlighting creates extreme CPU and memory amplification

- Severity: High availability
- Confidence: High; dynamically measured
- Affected components: Public repository blob and pull-request diff rendering
- Preconditions: A public supported-language file near the preview limit. An attacker can create
  the repository while authenticated and repeat the expensive read anonymously.

Evidence:

- [`services/git/src/storage/infrastructure/repository_browser.rs`](services/git/src/storage/infrastructure/repository_browser.rs#L21)
  permits text previews up to 1 MiB.
- [`apps/api/src/modules/repositories/presentation/repository-browser.controller.ts`](apps/api/src/modules/repositories/presentation/repository-browser.controller.ts#L33)
  permits anonymous reads when the repository is public.
- [`apps/api/src/shared/helpers/source-code-highlighting.ts`](apps/api/src/shared/helpers/source-code-highlighting.ts#L56)
  tokenizes the complete input twice for light and dark themes.
- [`apps/api/src/modules/repositories/helpers/repository-blob-highlighting.ts`](apps/api/src/modules/repositories/helpers/repository-blob-highlighting.ts#L25)
  later returns only the light result, making the dark pass pure server overhead.
- Pull-request diff highlighting can perform the same work across both sides of a changed file.

Measured result for an exact 1,048,576-byte TypeScript input through the real helper:

| Measurement | Result |
| --- | ---: |
| Input lines | 20,165 |
| Combined generated HTML characters | 15,406,054 |
| Processing time | approximately 2.6 seconds |
| Peak resident memory | approximately 389 MB |

The input respected the production 1 MiB ceiling. HTML output can legitimately expand far beyond
input size because each token receives markup for both themes.

Remediation:

1. Reduce server-side highlighting to approximately 100-200 KiB and add line and token caps.
2. Compute only the theme that is returned, or return structured tokens once.
3. Cache immutable results by Git object ID, language, and theme.
4. Add anonymous rate limits and a highlighting concurrency semaphore.
5. Consider client-side highlighting or a bounded worker pool for larger previews.
6. Add regression and load tests using near-limit adversarial content.

#### TSR-05: Authentication routes bypass the application body-size limit

- Severity: Medium to High availability, depending on edge limits
- Confidence: High
- Affected components: `/api/auth/*`, Hono adapter, Better Auth request parsing
- Preconditions: Anonymous network access to a valid body-consuming authentication endpoint.

Evidence:

- [`apps/api/src/main.ts`](apps/api/src/main.ts#L16) configures
  `skipBodyParserFor: ['/api/auth']`.
- [`apps/api/src/modules/auth/auth.module.ts`](apps/api/src/modules/auth/auth.module.ts#L21) also
  disables the Better Auth Nest body parser.
- The local Nest/Better Auth Hono patch sends the raw Fetch `Request` directly to Better Auth.
- The adapter's normal 1 MiB streaming limit is nested behind the parser skip and does not run for
  matching auth routes.
- Better Call parses JSON, form data, text, blobs, and array buffers through Fetch request methods
  without a byte limit on this path.

Impact:

A single valid unauthenticated request can buffer a very large or chunked body in memory and spend
CPU parsing it. Request-count rate limiting is only a partial mitigation because the cost is per
request. Any reverse-proxy limit is deployment-dependent and is not an application control.

Remediation:

1. Enforce a streaming byte limit before the raw Better Auth handler.
2. Do not rely only on `Content-Length`; terminate chunked bodies when the accumulated byte count
   crosses the limit.
3. Add endpoint-specific limits where smaller bodies are expected.
4. Test oversized fixed-length and chunked requests.

#### TSR-06: Broad GitHub OAuth tokens are stored in plaintext

- Severity: Medium-High confidentiality
- Confidence: High
- Affected components: Better Auth account storage and GitHub import
- Preconditions: Read access to the production database, a backup, or a sufficiently privileged
  read replica.

Evidence:

- [`packages/auth/server.ts`](packages/auth/server.ts#L103) requests classic GitHub `repo` scope.
- [`packages/db/schema/auth.schema.ts`](packages/db/schema/auth.schema.ts#L57) stores access,
  refresh, and ID tokens as plain text columns.
- [`apps/api/src/modules/github-import/infrastructure/github-import.repository.ts`](apps/api/src/modules/github-import/infrastructure/github-import.repository.ts#L66)
  returns the raw token directly from the database.
- Better Auth token-at-rest encryption is not enabled.

Impact:

A database or backup disclosure can expose live, write-capable credentials for users' private
GitHub repositories. The blast radius is wider than the Tessera database itself.

Remediation:

1. Move consumers to Better Auth's access-token retrieval and refresh boundary.
2. Enable encryption only together with a migration; current raw database readers would otherwise
   receive ciphertext and break imports.
3. Migrate existing values and rotate credentials where warranted.
4. Prefer a GitHub App or fine-grained permissions over classic `repo` scope.
5. Request repository access only when the user initiates import rather than on every sign-in.

#### TSR-07: Reachable dependency vulnerabilities require patching

| Dependency | Locked version | Assessment | Minimum patch |
| --- | ---: | --- | ---: |
| `hono` | `4.12.18` | Production-reachable CORS preflight header-splitting ReDoS. See [GHSA-8j4g-w8fx-2239](https://github.com/advisories/GHSA-8j4g-w8fx-2239). | `4.12.34` |
| `@grpc/grpc-js` | `1.14.3` | Malformed transport inputs can crash a server before application metadata authorization. Impact depends on gRPC network reachability. See [GHSA-5375-pq7m-f5r2](https://github.com/advisories/GHSA-5375-pq7m-f5r2) and [GHSA-99f4-grh7-6pcq](https://github.com/advisories/GHSA-99f4-grh7-6pcq). | `1.14.4` |
| `vite` | `8.0.2` | High on a network-exposed development host because the configured server binds `0.0.0.0`; not part of the production Nitro runtime. See [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583). | `8.0.5` |
| `better-auth` | `1.6.9` | Advisory-heavy, but most Critical and High entries concern disabled plugins. Upgrade before expanding authentication features. | Current tested release |

For Hono, [`apps/api/src/main.ts`](apps/api/src/main.ts#L26) enables CORS without a fixed
`allowHeaders` list, reaching the affected request-header split. For Vite,
[`apps/web/vite.config.ts`](apps/web/vite.config.ts#L104) exposes the development server on all
interfaces and leaves its WebSocket behavior enabled.

The raw `bun audit` count must not be presented as a count of exploitable application defects.
Better Auth device authorization, OIDC provider, MCP, magic-link, email-OTP, email/password,
anonymous, admin, and SCIM paths are not enabled. Other transitive findings were also rejected
where the affected adapter, operating system, protocol feature, or parser was not used.

#### TSR-08: Container and deployment packaging retain unnecessary source and secrets exposure

- Severity: Medium, conditional
- Confidence: High
- Affected components: API Docker image and Railway start command
- Preconditions: A Docker build context containing local secrets or other sensitive untracked
  files; image, registry, cache, or container access for disclosure.

Evidence:

- There is no root `.dockerignore`.
- [`apps/api/Dockerfile`](apps/api/Dockerfile#L10) and the production stage at line 19 both use
  `COPY . .`.
- [`.gitignore`](.gitignore#L9) identifies `.env` and related files, but Docker does not apply
  `.gitignore` to the build context.
- [`docker-compose.yml`](docker-compose.yml#L3) builds from the repository root and expects an
  optional root `.env`.
- [`apps/api/package.json`](apps/api/package.json#L8) builds `dist`, but the normal `start` script
  runs `bun src/main.ts`; `start:prod` is the script that runs the artifact.
- [`apps/api/Dockerfile`](apps/api/Dockerfile#L20) and
  [`apps/api/railway.json`](apps/api/railway.json#L5) build the artifact, then start through the
  source-based root `start:api` command.

Impact:

Docker builds can place sensitive context files in image layers if those files exist locally. The
production runtime also retains the complete workspace and dependency tree, and build success does
not prove that the exact built artifact is what starts.

Current deployment counterevidence:

Railway currently uses RAILPACK rather than this Dockerfile, so Docker-layer exposure is
conditional on Compose, manual Docker, or another CI path. Railway still builds an artifact and
then starts source, so the artifact/runtime mismatch applies independently.

Remediation:

1. Add a strict root `.dockerignore` covering `.env*`, keys, `.git`, `node_modules`, Rust targets,
   caches, reports, and generated outputs not required by the build.
2. Use allowlisted copies and separate builder and minimal runtime stages.
3. Start `dist/main.js`, not `src/main.ts`, in production.
4. Install only production dependencies in the runtime image.
5. Run under a non-root user and pin base images to reviewed immutable versions or digests.
6. Rebuild and rotate credentials only if secret-bearing images were actually produced or shared.

### P2: Operational Hardening

#### TSR-09: RPC deadlines, transport, and credentials need hardening

- Most API-to-Git storage RPC calls in
  [`apps/api/src/config/git-storage/git-storage.client.ts`](apps/api/src/config/git-storage/git-storage.client.ts#L90)
  have no deadline. Only merge applies an RxJS timeout.
- Smart HTTP authorization has no endpoint deadline, while the SSH authorizer applies five-second
  connect and operation timeouts.
- API and Git gRPC servers use plaintext transport.
- [`docs/railway-deployments.md`](docs/railway-deployments.md#L50) instructs deployments to reuse
  the same bearer value in both communication directions.
- Token schemas generally require only a nonempty string, not production-grade entropy.

Use explicit per-operation deadlines and cancellation, separate high-entropy directional tokens,
private listener exposure, and mTLS where the deployment model supports it. The GitHub OAuth token
also crosses this boundary during import, increasing the value of transport protection.

#### TSR-10: Private client data remains in memory after logout

- Severity: Medium conditional, shared-browser or cross-tab scenario
- [`apps/web/src/modules/auth/hooks/use-auth.ts`](apps/web/src/modules/auth/hooks/use-auth.ts#L26)
  invalidates only the session query and navigates home.
- Identity-bound query keys do not contain the viewer identity.
- TanStack Query's `ensureQueryData` returns cached data when present; inactive queries remain for
  the default five-minute garbage-collection period.
- The raw personal-access-token creation result also remains in mutation state until garbage
  collection.

An ordinary same-tab OAuth sign-in performs a full navigation and destroys memory, so this is not
a normal remote cross-account leak. It can matter when cookies switch accounts in another tab,
when a browser is shared, or when later script compromise inspects retained mutation data.

Clear private query and mutation caches after successful logout, scope private keys by viewer or
session epoch, immediately reset raw-token mutation state, and test cross-tab account changes.

#### TSR-11: GitHub import and reconciliation can become inconsistent

- [`apps/api/src/modules/github-import/application/github-import.processor.ts`](apps/api/src/modules/github-import/application/github-import.processor.ts#L73)
  commits repository and external-source state before separately marking the import successful.
  If that final update fails, the catch path marks the import failed even though a usable
  repository exists. A retry then collides with the existing target.
- Initial GitHub synchronization paginates every pull request, fetches additional merged-PR data,
  and reconciles PRs serially after the last lease heartbeat. A sufficiently large repository can
  outlive the default 15-minute lease and cause duplicate API and database work.
- Repository create/import failure paths can leave orphaned Git directories because no Git-storage
  deletion RPC exists.

Make completion idempotent and reconcilable, record safe continuation progress, heartbeat while
processing pages, group events once, and add storage cleanup or a durable orphan sweeper.

#### TSR-12: Cross-table handle uniqueness remains race-prone

Usernames and organization slugs are unique only inside their own tables. Application hooks check
the other table, but no shared database constraint closes the concurrent-create race. The code
already identifies this as TES-61 in [`packages/auth/server.ts`](packages/auth/server.ts#L121).

The result is route shadowing or ambiguous ownership, not a demonstrated authorization bypass.
Use a shared handle registry or another transactional database-enforced cross-namespace unique
constraint.

#### TSR-13: CI and automation have avoidable supply-chain blast radius

- [`.github/workflows/main.yml`](.github/workflows/main.yml#L14) repeatedly uses
  `actions/checkout@master`.
- [`.github/actions/setup/action.yml`](.github/actions/setup/action.yml#L7) uses a mutable major
  setup action tag.
- [`.github/workflows/claude.yml`](.github/workflows/claude.yml#L21) grants broad repository,
  project, issue, pull-request, and OIDC permissions to a mutable `@beta` action with unrestricted
  Bash and additional tools.

The Claude action performs its own collaborator permission check, so an arbitrary public commenter
cannot normally execute Claude with repository credentials. Public comments can still start the
workflow and consume pre-gate setup time, while a maintainer-triggered run can ingest attacker
controlled issue or pull-request content into a highly privileged agent.

Pin all third-party actions to reviewed commit SHAs, add a cheap actor/association gate before
checkout and installation, remove unused permissions and tools, separate analysis from approved
write actions, and add `bun audit` and current Rust advisory feeds to CI.

#### TSR-14: Development services are exposed too broadly

[`docker-compose.yml`](docker-compose.yml#L22) publishes Postgres on all interfaces with predictable
development credentials. Redis is also published on all interfaces with an empty password. The
default Git HTTP and SSH hosts bind to all IPv6 interfaces.

This is a development-host risk rather than evidence of production exposure. Bind local services
to `127.0.0.1`, require nonempty development credentials, and pin service images instead of using
`latest`.

#### TSR-15: Browser and proxy hardening is incomplete

- Production SSR code does not set an explicit authenticated-response `Cache-Control: private,
  no-store` policy or `Vary: Cookie`. No shared cache is configured in the repository, so this is
  conditional hardening.
- No application-level CSP, `frame-ancestors`, `nosniff`, Referrer-Policy, Permissions-Policy, or
  HSTS configuration was found. Edge-injected headers were outside scope.
- The auth proxy forwards client-supplied forwarding headers. Better Auth can treat the first
  `X-Forwarded-For` value as the client address, making rate-limit bypass possible when the external
  edge appends rather than replaces the header.
- Cross-subdomain cookies are enabled automatically on qualifying custom domains. A compromised
  sibling subdomain could receive the parent-domain session cookie. Railway public domains are
  deliberately excluded.

Set authenticated SSR cache policy explicitly, add a nonce-based CSP and baseline browser headers,
strip and reconstruct trusted forwarding headers, and make parent-domain cookies an explicit
deployment opt-in.

## 5. Architecture and Complexity Review

### 5.1 Centralize Git subprocess policy

One logical `RepositoryStorage` implementation spans approximately 2,783 production lines across
storage, browser, comparison, commits, merge, and GPG files. Git commands are also constructed in
Smart HTTP and SSH. Timeout, environment, output, kill-on-drop, and error policies have already
diverged.

Introduce:

- A `RepositoryLocator` that derives physical paths from repository IDs.
- A hardened `GitCommandRunner` that owns sanitized environment, timeout, cancellation,
  kill-and-reap behavior, output limits, process groups, and error mapping.
- Focused importer, browser, comparator, merger, signature, Smart HTTP, and SSH services around
  that shared runner.

Keep parsers and feature-specific interpretation close to their domain rather than creating a
generic command abstraction that understands every Git result.

### 5.2 Split repository application responsibilities

[`apps/api/src/modules/repositories/application/repositories.service.ts`](apps/api/src/modules/repositories/application/repositories.service.ts#L179)
is 1,137 lines with seven dependencies. It combines:

- Repository lifecycle and import orchestration.
- Mirroring.
- Browser and raw-read orchestration.
- HTTP and SSH authorization.
- Permission checks and storage wrappers.

Split lifecycle, browser, repository-access, and Git-authorization services. Preserve a temporary
facade during migration to avoid a large consumer rewrite.

The persistence layer has similar concentration:

| Component | Approximate production lines | Main concerns |
| --- | ---: | --- |
| `RepositoriesRepository` | 1,191 | Repository persistence, collaborators, organization access, legacy synchronization, leases, and push-back state. |
| `GitHubSyncRepository` | 1,237 | Lease/version state, webhook deliveries, installations, reconciliation, and transactions. |
| `PullRequestsRepository` | 904 | Native PR lifecycle, merges, provider reconciliation, and GitHub-specific mapping. |

The transactional lease and reconciliation sections contain justified complexity and should not be
split in ways that break atomicity. Prefer a transactional facade with focused private query stores
and provider-neutral application ports.

### 5.3 Remove unwired synchronization and push-back surface

Approximately 419 lines of legacy synchronization, account lookup, and push-back state methods are
unreferenced in production. The active synchronization implementation lives elsewhere, while the
unused Git push-back RPC remains exposed through the internal gRPC surface.

Remove the legacy methods and module export. Either remove push-back until it is implemented or
place it behind one explicit feature-owned module, worker, repository, authorization boundary, and
feature gate.

### 5.4 Stop treating absolute filesystem paths as repository identity

The database persists `storagePath`; nearly every API-to-Git RPC sends it; the Rust service then
derives the expected path from the repository UUID and rejects any different value. A mount-root
change can therefore invalidate every stored repository despite the UUID already being sufficient.

Send only the repository UUID and derive the path inside the Git service. If future sharding needs
routing, use an opaque stable locator rather than an absolute host filesystem path.

### 5.5 Make the gRPC mapping boundary fail closed

The TypeScript Git-storage mapper is approximately 545 lines, shadows generated messages with
nested `Partial` types, converts required-looking values to empty strings, and converts unknown
enums into plausible states. This can hide protocol drift as valid domain data.

Align generated types and proto-loader options, validate each response once at the client boundary,
fail on missing required semantic values, and handle unspecified or unknown enum values explicitly.

### 5.6 Consolidate duplicated authorization clients

Smart HTTP and SSH contain separate API authorization clients. They already differ in connection
and request timeout behavior and classify a mirror denial by matching human-readable error prose.

Use one internal authorization client for endpoint, deadline, credentials, and status mapping.
Return typed protocol error reasons instead of parsing English messages.

### 5.7 Frontend complexity is generally controlled

The largest hand-authored production frontend components remain within the repository's 300-line
limit. Some repository browser shell behavior is duplicated, but frontend decomposition is not a
priority compared with the API and Git service boundaries above.

## 6. Strong Existing Controls

The following controls held up under adversarial review:

- Sensitive repository operations have service-layer role checks in addition to controller guards.
- Private and nonexistent repositories intentionally produce indistinguishable not-found behavior.
- Git storage uses opaque UUID-derived paths, canonical containment, and symlink rejection.
- Git refs and object IDs are validated; commands avoid shells and use `--end-of-options` where
  appropriate.
- The SSH public-key callback occurs after the library verifies key possession.
- Source-highlighting token content is escaped, and Markdown rendering skips raw HTML.
- GitHub webhook signatures use HMAC-SHA256 with timing-safe comparison.
- Webhook deliveries and synchronization use database idempotency, leases, advisory locks, and
  compare-and-set style protections.
- SSR creates a new QueryClient per request, avoiding cross-request in-memory cache mixing.
- GPG verification uses isolated homes.
- Pull-request merge uses expected SHAs, leases, and database constraints.
- The Rust storage gRPC bearer comparison is constant-time.

## 7. Rejected and Downranked Claims

The following candidate findings were rejected or materially narrowed:

- No direct SQL injection, shell injection, repository path traversal, or application-level
  authorization bypass was found.
- GitHub import does not expose an arbitrary URL-fetch SSRF path in the reviewed flow; the source is
  derived from GitHub repository identity and normal Git protocol behavior.
- Shiki and Markdown raw-HTML sinks receive escaped token HTML or skip raw HTML; no source-driven
  XSS was confirmed.
- The Hono wildcard-origin-with-credentials advisory does not apply because Tessera configures an
  explicit origin. The separate CORS request-header ReDoS does apply.
- Better Auth's many audit findings were not promoted when their device, OIDC-provider, MCP,
  magic-link, email-OTP, email/password, anonymous, admin, or SCIM paths were disabled.
- The `rsa` Marvin timing advisory is not currently reachable through Tessera's Ed25519 host-key
  operation. It should be monitored if RSA private operations are enabled later.
- The transitive `anyhow` advisory is present only in build/proc-macro tooling on the reviewed path.
- The Vite finding affects exposed development servers, not the production Nitro runtime.
- The gRPC crash advisories are serious but production reachability depends on listener topology.
- Logout cache retention is a shared-browser or cross-tab concern, not a normal remote account
  boundary bypass.
- An arbitrary outsider cannot normally execute the Claude action because the action performs a
  write-permission gate. Mutable action references and maintainer-mediated prompt injection remain
  separate concerns.
- The Opus claim that the known secret directly forges arbitrary session cookies was corrected:
  normal session tokens still require database records. The final account-takeover finding is based
  on the verification route creating a real session.
- The Opus claim that 15.4 million output characters were impossible from a 1 MiB input was rejected;
  the measured result is markup expansion across two complete themes.
- The Opus claim that Hono's applicable ReDoS required a regex origin was rejected; the vulnerable
  operation is request-header splitting when `allowHeaders` is absent.

## 8. Verification Results

| Check | Result |
| --- | --- |
| `bun run check` | Passed across 562 files with no fixes. |
| `bun run typecheck` | Passed across 10 tasks. |
| API unit tests | 538 tests across 72 files passed. |
| Web tests | 125 tests across 16 files passed after supplying safe explicit public Git URL test values. |
| Rust tests | 153 unit, storage, Smart HTTP, and SSH tests passed. |
| Shiki amplification benchmark | Reproduced through the real helper with a production-limit 1 MiB input. |
| `bun audit --json` | 88 raw advisories: 2 Critical, 37 High, 40 Medium, and 9 Low. Reachability was triaged rather than equating raw counts with vulnerabilities. |
| `cargo audit` | Reported the conditional RSA timing advisory, build-only `anyhow` warning, and yanked `aes` and `spin` releases. Newer `russh` GHSAs required separate current-advisory review. |
| Git worktree | Clean after the read-only audit. |

`cargo clippy -p tessera-git --all-targets --all-features -- -D warnings` did not pass. It reported
10 production diagnostics:

1. `clippy::too_many_arguments` in the Smart HTTP request handler.
2. `clippy::needless_borrow` in repository browsing.
3. Three `clippy::collapsible_if` diagnostics in repository browsing.
4. `clippy::collapsible_match` in repository browsing.
5. `clippy::needless_question_mark` in repository commits.
6. `clippy::collapsible_if` in repository comparison.
7. `clippy::needless_borrows_for_generic_args` in repository storage.
8. `clippy::ptr_arg` in repository storage.

The test target additionally reported two octal-escape diagnostics from one repository-commit test
literal.

Database-backed API integration tests and full browser/Git E2E suites were not run. The review did
not start or inspect environment-dependent services. The initial top-level web test command also
required documented public Git URL variables; isolated tests passed with safe local values.

## 9. Remediation Roadmap

### Immediate

- Verify, rotate, and enforce `AUTH_SECRET`.
- Audit deployments that might have accepted the known fallback.
- Upgrade `russh` to `0.62.6` or later.
- Patch Hono, gRPC JS, Vite, and Better Auth to reviewed supported versions.

### Within 48 Hours

- Put an independent streaming limit in front of `/api/auth/*`.
- Lower highlighting limits, eliminate discarded-theme work, and add concurrency protection.
- Add Git connection, process, input, output, ref, tree, storage, and disk limits.
- Add child kill/reap behavior to every timeout and client-cancellation path.
- Pin CI actions and reduce Claude workflow permissions and tools.

### Next Sprint

- Implement a centralized `GitCommandRunner` and shared authorization client.
- Stream Smart HTTP responses and drain process pipes concurrently.
- Introduce pagination for refs and trees.
- Migrate and encrypt GitHub OAuth tokens and reduce GitHub scope.
- Correct production artifact startup and container composition.
- Add RPC deadlines, separate directional secrets, and transport protection.
- Clear private client caches on logout.
- Repair import completion, reconciliation heartbeat, and orphan-storage behavior.

### Longer-Term Architecture Work

- Split repository lifecycle, browsing, access, and Git authorization services.
- Isolate provider-neutral pull-request reconciliation from GitHub infrastructure types.
- Remove legacy synchronization and unused push-back surface.
- Derive storage paths solely inside the Git service.
- Make the gRPC mapping boundary strict and fail closed.
- Add database-enforced cross-namespace handle uniqueness.
- Add continuous dependency, Clippy, resource-limit, and security regression checks.

## 10. Appendix

### 10.1 Finding Index

| ID | Priority | Summary |
| --- | --- | --- |
| TSR-01 | P0 / Conditional Critical | Known fallback auth secret can enable account takeover. |
| TSR-02 | P0 / High | Public SSH server uses a vulnerable `russh` release. |
| TSR-03 | P1 / High | Git transport and subprocesses permit compounding resource exhaustion. |
| TSR-04 | P1 / High | Public syntax highlighting has severe CPU and memory amplification. |
| TSR-05 | P1 / Medium-High | Authentication routes bypass the normal body-size limit. |
| TSR-06 | P1 / Medium-High | Broad GitHub OAuth tokens are stored in plaintext. |
| TSR-07 | P1 / Mixed | Reachable Hono, gRPC JS, Vite, and dependency issues require updates. |
| TSR-08 | P1 / Medium | Container and production packaging retain unnecessary source and context risk. |
| TSR-09 | P2 / Medium | RPC deadlines, transport security, and credentials need hardening. |
| TSR-10 | P2 / Medium conditional | Private client data remains cached after logout. |
| TSR-11 | P2 / Medium | Import and reconciliation can become inconsistent. |
| TSR-12 | P2 / Low-Medium | User and organization handle uniqueness is race-prone. |
| TSR-13 | P2 / Medium | CI automation has avoidable supply-chain blast radius. |
| TSR-14 | P2 / Conditional | Development services bind too broadly. |
| TSR-15 | P2 / Low-Medium | Browser, cache, forwarding-header, and cookie hardening is incomplete. |

### 10.2 Review Limitations

- Live production configuration, secrets, network policies, edge limits, logs, data, and images were
  not inspected.
- No destructive or production-facing proof of concept was attempted.
- Advisory status and current dependency versions can change after the review date.
- Static review cannot prove the absence of all vulnerabilities; the report records the strongest
  evidence-backed findings and reviewed counterevidence available at commit `810dd86`.
