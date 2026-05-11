# Tessera Specification

## Summary

Tessera is an open source Git collaboration platform for teams that want a focused, trustworthy place to host repositories, browse code, review pull requests, and connect their existing developer tools.

The product should not try to become "GitHub, but cloned feature-for-feature." The strongest wedge is a clean code collaboration experience with reliable Git hosting, strong review ergonomics, and a first-class integration model for tools that already do their jobs well.

## Positioning

Tessera should be understood as:

> Open source Git collaboration with excellent repository browsing, pull requests, review workflows, and extensible integrations.

Tessera should not be positioned as:

- A full GitHub replacement on day one.
- A CI/CD platform.
- An issue tracker.
- A marketplace-first integration platform before the core Git product is good.
- A closed source source-code hosting service.

The first durable value must be that developers prefer hosting, browsing, and reviewing code in Tessera.

## Product Principles

- Trust first: the project should be open source because users are trusting Tessera with source code, repository history, private access, SSH keys, pull requests, and team membership.
- Core before ecosystem: integrations matter, but the Git hosting, browsing, and review surface must be valuable before integrations become the focus.
- Integrate adjacent tools: CI/CD, issue tracking, AI coding tools, chat, and deployment systems should be integrated rather than recreated too early.
- Keep the product focused: avoid broad project management, social coding, and automation sprawl until repository workflows are excellent.
- Make migration low-risk: users should be able to import or mirror from GitHub before they fully switch.
- Design for self-hosting and hosted SaaS from the beginning.

## Core Product Scope

Tessera owns:

- Authentication and account identity.
- User profiles.
- Organizations.
- Repository metadata and namespaces.
- Git repository storage and access.
- Repository browsing.
- README rendering.
- File tree navigation.
- File preview and syntax highlighting.
- Branches, tags, and commit history.
- Pull requests.
- Diff viewing.
- Merge, squash, and rebase workflows.
- Code review comments and approvals.
- Permissions and branch protection.
- Commit statuses and checks model.
- Webhooks and event emission.
- Auditability for important repository and organization actions.
- Integration orchestration once the core product is solid.

Tessera should integrate rather than own:

- CI/CD execution.
- Issue tracking.
- AI coding agents.
- Chat notifications.
- Deployment platforms.
- Observability tools.

## MVP Definition

The first meaningful MVP is a read-only and auth-capable Git hosting shell:

- A user can sign in with GitHub.
- A user has a profile page.
- A user can create or own repositories.
- A repository can exist in metadata and later in Git storage.
- A repository page can display README content.
- A repository page can display a directory tree.
- A user can click through directories.
- File preview can be added immediately after tree browsing.

The first "real" product loop is:

> Create repo -> push code -> browse repo -> read README -> navigate files.

Pull requests and integrations come after this loop works.

## Product Phases

### Phase 1: Core Git Hosting

Tessera should support auth, profiles, user-owned repositories, organization-owned repositories, and basic repository pages.

### Phase 2: Code Browsing

Tessera should support README rendering, branch selection, directory navigation, file previews, syntax highlighting, raw file access, and commit history.

### Phase 3: Pull Requests

Tessera should support comparing branches, viewing commits, viewing changed files, reviewing diffs, and merging pull requests.

### Phase 4: Collaboration

Tessera should support inline comments, review threads, approvals, notifications, audit logs, and branch protection.

### Phase 5: Adoption Layer

Tessera should support GitHub import, GitHub mirroring, and migration tooling so teams can try the product without immediately abandoning GitHub.

### Phase 6: Integrations

Tessera should integrate with external CI/CD, issue tracking, AI coding, chat, deployment, and observability tools.

## Authentication

The first authentication method is GitHub social login through Better Auth. Email/password login is intentionally deferred.

Tessera should eventually support:

- Additional OAuth providers.
- Personal access tokens.
- Git-specific tokens.
- SSH keys.
- Deploy keys.
- Organization SSO for enterprise customers.
- SCIM provisioning for enterprise customers.

The web app should use a same-origin auth proxy to simplify browser auth and Railway deployment. The API remains the source of truth for sessions and authorization.

## Organizations

Organizations are first-class and should be implemented before GitHub migration or external integrations.

Organizations should eventually support:

- Organization profile pages.
- Members.
- Roles.
- Invitations.
- Repository ownership.
- Organization-level settings.
- Organization-level billing.
- Organization-level integrations.
- Organization audit logs.
- Teams or groups.
- Enterprise SSO and SCIM later.

Initial roles can be simple: owner, admin, member.

## Repository Model

Repositories can be owned by either a user namespace or an organization namespace.

Repositories should have:

- Stable ID.
- Name.
- Description.
- Visibility.
- Owner namespace.
- Default branch.
- Storage location.
- Created and updated timestamps.

Initial visibility modes:

- Public.
- Private.

Potential future visibility modes:

- Internal, visible to all organization members.

Repository names should follow Git-hosting expectations: short, URL-safe, and stable. Human-facing repository URLs should use owner slug plus repository name, but storage paths should use opaque IDs.

## Git Storage

Tessera must not invent a new Git object storage format. Git itself is the storage engine.

The canonical repository storage unit is a bare Git repository:

```text
/data/git/repositories/{repo_id}.git
```

The database stores repository metadata, permissions, and storage pointers. It does not store every Git object, file, commit, tree, or blob.

Tessera should eventually support:

- Bare repository creation.
- Bare repository deletion.
- Git tree reads.
- Git blob reads.
- README discovery and rendering.
- Branch listing.
- Tag listing.
- Commit history.
- HTTP clone/fetch/push.
- SSH clone/fetch/push.
- Push events.
- Repository maintenance.
- Garbage collection.
- Size calculation.
- Backups.
- Restore workflow.
- Storage sharding.
- Storage node health checks.

The first implementation may use the Git CLI under careful process control. Tessera can later adopt `gix` or `libgit2` for selected structured operations if it helps.

## Git Service

The Git service is a Rust service. It owns Git storage and Git protocol behavior.

The Git service should own:

- Bare repository filesystem layout.
- Safe path construction.
- Git command execution.
- HTTP Git access.
- SSH Git access.
- Git read APIs.
- Push handling.
- Repository maintenance.
- Storage node behavior.
- Git event emission.

The Git service should not own:

- User accounts.
- Sessions.
- Organization membership.
- Product-level permission rules.
- Branch protection policies.
- Billing.
- External integrations.

The Git service should ask the NestJS API for authorization decisions over internal Railway networking.

## Authorization Boundary

The NestJS API is the control plane and source of truth for product authorization.

The Rust Git service asks the API questions such as:

- Who owns this HTTP token?
- Which user owns this SSH key?
- Can this actor read this repository?
- Can this actor push to this repository?
- Can this actor push to this ref?
- Is this branch protected?
- Is this deploy key allowed?
- Where is the repository stored?

This avoids duplicating authorization logic in Rust and TypeScript.

Direct Git-service-to-Postgres reads may be considered later only if performance or availability requires a cache or read model. The first design should prefer API-mediated authorization.

## Storage Scaling

The first version can run on one storage node with local persistent disk. The data model should still reserve room for storage nodes and storage paths so the system can grow.

Future storage should support:

- Multiple storage nodes.
- Repository placement.
- Capacity tracking.
- Storage health.
- Scheduled backups.
- Restore workflows.
- Read mirrors.
- Push replication.
- Disaster recovery.

This should be designed carefully but not overbuilt before the core product loop exists.

## Pull Requests

Pull requests are core to the product and should become the second major value pillar after repository browsing.

Pull requests should eventually support:

- Source branch and target branch.
- Cross-repository forks later.
- Commit list.
- Changed files.
- Unified diff view.
- Split diff view later.
- Merge commit.
- Squash merge.
- Rebase merge.
- Merge conflict detection.
- Required checks.
- Required reviews.
- Branch protection.
- Review comments.
- Inline threads.
- Conversation timeline.
- Draft pull requests.
- Notifications.

The PR MVP can be much smaller:

- Compare two branches.
- Show commits.
- Show changed files.
- Show unified diff.
- Merge button.

## Issues

Native issues are not part of the early product direction.

Tessera should integrate with existing issue trackers first:

- Linear.
- Jira.
- ClickUp.

The first issue integration should link external issues to branches, commits, and pull requests. Tessera should detect issue keys in branch names, commit messages, and PR titles.

Native issues can be reconsidered later if users clearly need them.

## CI/CD

Tessera should not build its own CI/CD system early. CI/CD is not the core product wedge.

The first preferred integrations are:

- Depot.
- Blacksmith.

Tessera should own a checks/statuses model so external CI/CD systems can report build state back to commits and pull requests.

Tessera should eventually support:

- Commit statuses.
- Check runs.
- Required checks.
- Build logs linking.
- Organization-level CI provider configuration.
- Repository-level CI provider configuration.
- Webhook delivery.

## Integrations

Integrations should come after the core Git and PR experience.

Integration categories:

- CI/CD: Depot, Blacksmith, Buildkite later.
- Issues: Linear, Jira, ClickUp.
- AI coding: Codex, Cursor, Claude Code.
- Chat: Slack, Discord, Teams.
- Deploys: Vercel, Fly.io, Render, Railway, Cloudflare.
- Observability: Sentry.

Tessera should eventually behave as a source-of-truth event hub:

```text
push -> repo.push -> CI provider
pull_request.opened -> issue link -> AI review -> chat notification
review.submitted -> issue status update
pull_request.merged -> deployment or ticket update
```

No plugin marketplace is needed for MVP. The first integration system can be an internal provider abstraction.

## GitHub Adoption Layer

GitHub migration is important because it lowers adoption risk.

GitHub support should evolve through three phases:

### Import

- Connect GitHub.
- List repositories.
- Import selected repositories.
- Mirror Git history.
- Preserve branches.
- Preserve tags.
- Preserve commit authors.

### Mirror

- One-way mirror from GitHub to Tessera first.
- Display mirrored repository state.
- Allow teams to use Tessera browsing and review without cutting over immediately.

### Cutover

- Help users switch remotes.
- Make Tessera the source of truth.
- Optionally push mirror back to GitHub.
- Provide migration docs and commands.

Open PRs, issues, and comments can be imported later. Repository history comes first.

## Open Source Strategy

Tessera should start as a fully open source monorepo. No Enterprise Edition directory exists yet.

The project can introduce an `ee/` directory later only when there is a specific enterprise-only feature that justifies a commercial license boundary.

Source code for billing can be open source. Secrets, payment provider keys, webhook secrets, and customer data must remain environment/runtime data.

Open sourcing payment integration code is acceptable and can build trust.

## Monetization

Tessera can monetize without hiding the core product.

Potential monetization:

- Hosted cloud.
- Paid private repositories on hosted cloud.
- Per-seat hosted organizations.
- Storage and bandwidth limits.
- Managed backups.
- Managed GitHub migration.
- Premium support.
- Enterprise contracts.
- Commercial licensing if an enterprise split appears later.

Potential paid or enterprise features later:

- SAML SSO.
- SCIM.
- Advanced audit logs.
- High availability storage.
- Advanced branch protection.
- Merge queue.
- Organization-wide policy engine.
- Advanced GitHub mirroring.
- Advanced integration governance.
- Advanced AI review workflows.

Basic integrations should not be aggressively paywalled at first, because integrations are part of the product wedge. It is better to charge for scale, governance, support, hosted convenience, and enterprise requirements.

## Licensing Direction

The favored direction is open source core with a hosted SaaS business.

Potential license choices:

- AGPL core with commercial enterprise licensing later.
- Apache-2.0 core with paid hosted/enterprise features later.

AGPL better protects a network-service business, while Apache-2.0 maximizes adoption. This decision is intentionally deferred until the project is closer to public release.

## Technology Direction

Tessera uses a TypeScript-first product stack with a Rust Git service.

The TypeScript stack owns product iteration speed and web/API development. Rust owns the Git storage and protocol surface because that area benefits from filesystem safety, process control, streaming IO, and strong boundaries.

The initial stack:

- Bun workspaces.
- Turborepo.
- TanStack Start web app.
- NestJS API.
- Hono adapter.
- Better Auth.
- oRPC contracts.
- Drizzle ORM.
- Postgres.
- Redis.
- BullMQ.
- S3-compatible storage.
- Shared UI package.
- Rust Git service later.

## Monorepo Direction

Tessera should remain a monorepo.

The monorepo should keep:

- Web app.
- API app.
- Shared TypeScript packages.
- Rust Git service.
- Documentation.
- CI.
- Deployment configuration.
- Agent instructions.

No separate hidden fork should exist. If enterprise code is introduced later, it should be explicit and maintainable.

## Design Direction

Tessera should feel like a serious developer tool.

The product should be:

- Calm.
- Technical.
- Trustworthy.
- Dense enough for repeated use.
- Clear under pressure.
- Optimized for code browsing and review.

The product should avoid:

- Generic SaaS marketing dashboards inside the app.
- Decorative card-heavy layouts.
- Loud gradients.
- One-note palettes.
- UI that distracts from code.
- Landing-page-first structure for logged-in workflows.

## Non-Goals For Early Versions

- Native CI/CD execution.
- Native issue tracker.
- Marketplace-style plugin system.
- GitHub-scale Actions replacement.
- Full GitHub issue/PR import on day one.
- Advanced enterprise SSO/SCIM.
- High availability storage.
- Console-level deployment complexity.
- Building a new Git object storage format.
