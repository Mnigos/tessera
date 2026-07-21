# ADR 0001: Organization roles map into repository permissions behind a single resolver

- Status: accepted
- Date: 2026-07-16
- Context: TES-54 (repository collaborator roles and pull request permissions), TES-60 umbrella

## Context

Repositories are owned by either a user or an organization (`repositories.ownerUserId` XOR
`repositories.ownerOrganizationId`). TES-54 introduces per-repository collaborator roles
(`read` / `write` / `admin`) and a central permission resolver. Organizations already have
membership roles (`member.role`: `owner` / `admin` / `member`), but there is no defined
mapping from organization membership to repository access, and designing one properly
(default member access, per-repo overrides, team constructs) is out of scope while the
product is only exercised locally by a single user.

## Decision

All permission checks go through one resolver:

```text
RepositoryPermissionsService.resolveRole(viewerUserId, repository)
  -> 'owner' | 'admin' | 'write' | 'read' | null
```

The resolver also exposes `resolveImplicitRole(viewerUserId, repository)`, which returns
only the ownership- or organization-derived role (no collaborator rows, no public read).
Collaborator management uses it to reject grants for users who already hold implicit
admin-or-higher access.

For organization-owned repositories, the mapping from organization membership to a
repository role is implemented behind a single private function inside the resolver. The
initial mapping is deliberately minimal: org `owner`/`admin` -> repository `admin`; org
`member` -> no implicit access (must be added as a repository collaborator). No consumer
(guards, pull request services, comments, reviews, checks, branch protection, merge queue)
may inspect organization membership directly.

Users and organizations share the `/{handle}` URL namespace. When both exist, the user
handle wins deterministically; to keep that case from arising, cross-namespace uniqueness
is enforced at creation time (organization creation rejects slugs matching an existing
username, and username resolution skips handles matching an existing organization slug).
A DB-level guarantee is tracked by TES-61.

## Consequences

- Guards and services stay correct regardless of how the org mapping evolves; changing the
  mapping is a one-function change plus tests.
- Org `member` users currently need explicit collaborator grants, which is acceptable for
  local/single-user usage.
- A future organizations iteration (default repository access per org, teams, per-repo
  role overrides) revisits only the mapping function and this ADR.
