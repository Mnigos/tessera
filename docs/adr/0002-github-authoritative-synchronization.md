# ADR 0002: GitHub-authoritative repositories synchronize one way until explicit cutover

- Status: accepted
- Date: 2026-07-25
- Context: TES-63, TES-70 umbrella, GitHub Pull Request Sync project

## Context

Tessera currently records GitHub repositories with one of three external-source modes:
`imported`, `github_to_tessera`, or `tessera_source`. Existing product documentation does
not consistently define authority, clone and write behavior, synchronization recovery, or
the boundary between provider data and Tessera's native pull request collaboration models.
Ambiguity here can create divergent histories, duplicate entities, and write-back loops.

## Decision

### Repository modes and transitions

| Mode | Authority | Inbound GitHub sync | Tessera Git writes | PR collaboration writes | Clone URLs | Allowed transition |
| --- | --- | --- | --- | --- | --- | --- |
| `imported` | Tessera after the import completes | None | Allowed by normal permissions | Native | Tessera HTTPS and SSH | None |
| `github_to_tessera` | GitHub | Webhooks plus backend reconciliation | Rejected with GitHub guidance | Written through to GitHub as the acting user, echoed locally; GitHub stays authoritative | GitHub HTTPS and SSH | `tessera_source` |
| `tessera_source` | Tessera | Stopped | Allowed by normal permissions | Native | Tessera HTTPS and SSH | None |

`imported` is a one-time snapshot, not a continuously mirrored repository. Import completion
establishes Tessera authority immediately. `github_to_tessera` keeps GitHub authoritative:
Git refs, checks, and GitHub-owned repository settings are a read-only synchronized view in
Tessera, and pull request collaboration is written through to GitHub as the acting user (see
"While GitHub is authoritative" below). `tessera_source` records an explicit,
irreversible cutover to Tessera authority. Reconnecting to GitHub requires a new import or
mirror rather than reversing the transition.

| Action | `imported` | `github_to_tessera` | `tessera_source` |
| --- | --- | --- | --- |
| Clone/fetch | Tessera URLs | GitHub URLs | Tessera URLs |
| Push/ref mutation | Tessera permissions | Reject; perform in GitHub | Tessera permissions |
| Create pull request | Tessera permissions | Read-only; perform in GitHub | Tessera permissions |
| Update/merge pull request | Tessera permissions | Written through to GitHub as the acting user | Tessera permissions |
| Comment/review | Tessera permissions | Written through to GitHub as the acting user | Tessera permissions |
| Checks/statuses | Native Tessera provider contract | Read-only GitHub synchronization into native models | Native Tessera provider contract |
| GitHub-owned settings | Not applicable | Read-only; change in GitHub | Historical only |
| Tessera-owned settings | Tessera permissions | Tessera permissions; never write back | Tessera permissions |

While GitHub is authoritative:

- clone and fetch guidance uses the GitHub repository's HTTPS and SSH URLs;
- users push branches and change GitHub-owned settings in GitHub;
- Tessera Git transports reject pushes and other ref mutations with actionable GitHub clone
  and push guidance;
- pull request collaboration — comments, threads, reviews, reviewer requests, pull request
  edits, lifecycle changes, and direct merges — may be performed from Tessera, which forwards
  each one to GitHub with the acting user's own GitHub credential before echoing it locally,
  so GitHub remains the authority that accepted or refused it; and
- Tessera never pushes Git refs or repository settings back to GitHub, and creating a pull
  request and joining the merge queue stay GitHub-only.

Tessera-owned settings, such as visibility of the synchronized view and integration
administration, remain mutable in Tessera. They do not mutate GitHub repository settings.

### Synchronization and reconciliation

Verified GitHub App webhooks are the primary update trigger. The webhook endpoint validates
the signature, records the GitHub delivery ID, and queues processing outside the request.
Jobs are ordered where entity or repository ordering matters and may be replayed safely.

A backend-owned schedule reconciles GitHub-authoritative repositories. Reconciliation reads
GitHub's current state, compares stable provider identities and cursors, and applies the same
idempotent upserts and tombstones as webhook processing. It repairs missed, duplicated,
delayed, and out-of-order events and updates freshness and failure state. There is no browser
or frontend scheduler, user-facing manual sync, or user-facing retry. Server/admin recovery
may replay deliveries or reconciliation jobs through the same idempotent path.

Stale events cannot replace newer provider state. Ref deletion, force-push, pull request
retargeting, edits, and deletion are represented explicitly; dependent comparisons, review
anchors, approvals, and checks become stale or outdated rather than silently attaching to
new state. Repository rename keeps the stable provider identity and refreshes names and clone
URLs. Repository transfer refreshes ownership and installation authorization. Deleted or
inaccessible repositories retain the last synchronized view, are marked stale or blocked,
and stop normal reconciliation until access is restored or an administrator resolves them.

### Identity and idempotency

GitHub App installation and stable GitHub node IDs are provider identity. Provider mappings
are separate from Tessera domain IDs and scoped by provider and repository. When a node ID is
not available, the documented immutable GitHub identifier for that entity is used; mutable
names, URLs, ref names, and pull request numbers are never the sole repository identity.

- webhook receipt idempotency key: GitHub delivery ID;
- repository key: provider plus GitHub repository node/database ID;
- entity key: provider repository identity plus entity type plus stable provider entity ID;
- ref key: provider repository identity plus fully qualified ref name, with the latest
  authoritative GitHub ref read or monotonic provider event version fencing stale updates;
- reconciliation key: provider repository identity plus resource kind plus durable cursor or
  page watermark.

GitHub actors map by stable provider account ID. A linked Tessera user may be attached, but
provider attribution is preserved independently. Unknown, renamed, suspended, or deleted
actors render a safe provider snapshot and GitHub link when available; they never inherit a
different Tessera user's identity because a login was reused.

Synchronized comments, threads, reviews, checks, statuses, and pull request activity reuse
the native Tessera Code Review and Checks entities delivered by TES-55, TES-57, and TES-58.
Provider mapping and provenance extend those models; synchronization does not create parallel
GitHub-only comment, review, or check domain models.

### Failure and security boundaries

Retries distinguish transient transport/server failures, GitHub rate limits, revoked or
insufficient permissions, invalid payloads, and permanent not-found results. Transient and
rate-limited work uses bounded exponential backoff and installation-aware rate-limit state.
Permission failures block affected repositories pending reauthorization. Invalid payloads
and permanent failures are retained with redacted diagnostics for server/admin recovery.
Partial progress is idempotent, preserves the last successful cursor, and never reports a
full success until the reconciliation unit converges.

GitHub App installation tokens are short-lived and least-privileged. Private keys, webhook
secrets, tokens, and raw credentials remain in secret storage and never enter provider
mapping, job, audit, log, or user-visible records. Webhook signatures are verified before
payload processing. Every read and recovery action is scoped to the current installation and
repository authorization. Logs, metrics, audit records, and failure messages contain provider
IDs and delivery IDs but redact credentials and sensitive payload content.

The GitHub App requests repository metadata plus read-only Contents, Pull requests, Issues,
Checks, and Commit statuses permissions. It subscribes only to `installation`,
`installation_repositories`, `repository`, `push`, `create`, `delete`, `pull_request`,
`pull_request_review`, `pull_request_review_comment`, `pull_request_review_thread`,
`issue_comment`, `check_suite`, `check_run`, and `status` events. Adding a permission or event
requires updating this ADR and the downstream
integration coverage; Tessera never requests GitHub write permissions for synchronization.

Signature verification is followed by an explicit event and action allowlist. Deliveries outside
the allowlist are recorded for audit and ignored rather than rejected, so GitHub is never asked to
redeliver work Tessera does not act on. The allowlist covers the installation, repository, and Git
reference events above; every `pull_request` action; `issue_comment` and
`pull_request_review_comment` `created`/`edited`/`deleted`; `pull_request_review`
`submitted`/`edited`/`dismissed`; `pull_request_review_thread` `resolved`/`unresolved`;
`check_run` `created`/`completed`; `check_suite` `completed`; and the actionless `status` event.
`check_run` `rerequested`/`requested_action` and `check_suite` `rerequested`/`requested` stay
outside the allowlist: answering them would require Checks write permission, and reconciliation
discovers a rerun through the events it does subscribe to. Conversation deliveries record the
target resource kind, its provider node and numeric IDs, and the originating issue number so
reconciliation reconciles the affected pull request even when the incremental cursor page omits
it. Check deliveries record the commit SHA and the status context or check-run name instead,
because a check reports against a commit that may belong to no pull request Tessera tracks or to
one whose head has already moved; such a delivery forces that commit into the next run and is
consumed only once the commit has been reconciled or proven unreconcilable.

### Cutover

Cutover is an explicit owner/admin action allowed only from `github_to_tessera` after a
successful synchronization and verification that GitHub and Tessera default-branch heads
match. The team pauses GitHub writes during the cutover window. Cutover atomically records
`tessera_source`, the actor and timestamp, stops new inbound synchronization and scheduled
reconciliation, increments an authority generation, invalidates queued GitHub work, switches
clone guidance to Tessera, and enables Tessera writes under normal repository permissions.
Every synchronization write, including an already-running job, transactionally rechecks both
`github_to_tessera` mode and the authority generation captured when the job started. A stale
generation cannot commit after cutover.

GitHub remains historical after cutover. Later GitHub changes do not flow into Tessera, and
Tessera never pushes post-cutover changes back to GitHub automatically or through a Tessera
manual mirror action.

## Delivery ownership

- TES-64: durable provider mappings, delivery IDs, cursors, authority generation, freshness,
  failure state, and removal of obsolete push-back persistence.
- TES-65: verified webhook ingestion, queues, repository refs, pull request lifecycle, and
  backend reconciliation; remove public manual-sync and push-back API/contracts.
- TES-66: GitHub checks/status synchronization using the native TES-55 checks model.
- TES-67: comments, inline threads, actors, and reviews using TES-57 and TES-58.
- TES-68: GitHub clone guidance, provenance, read-only controls, timeline, sync health, and
  removal of manual-sync and push-back UI.
- TES-69: retry policy, replay, rate limits, metrics, auditability, and operational recovery.

TES-55, TES-57, and TES-58 are prerequisites for native checks, comments/threads, and reviews.

## Consequences

- Authority is unambiguous and GitHub/Tessera feedback loops are impossible.
- Webhook latency and scheduled repair converge through one idempotent ingestion path.
- GitHub-authoritative views may be stale or partially available, so provenance and freshness
  must remain visible.
- Existing manual sync, push-back, Tessera clone guidance, and duplicate provider-model
  behavior that conflicts with this ADR must be removed or aligned by TES-64 through TES-69.
- Pull request write-through depends on the acting user's own GitHub OAuth token carrying
  repository scope, so a user whose grant is missing, revoked, or too narrow is asked to
  reconnect GitHub rather than served a Tessera-only failure.
- This ADR introduces no database migration, API behavior, UI behavior, or scheduler by itself.
