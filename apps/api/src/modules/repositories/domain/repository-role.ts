import type { RepositoryCollaboratorRole } from '@repo/domain'

export type RepositoryRole = 'owner' | RepositoryCollaboratorRole

const REPOSITORY_ROLE_RANK = {
	read: 0,
	write: 1,
	admin: 2,
	owner: 3,
} as const satisfies Record<RepositoryRole, number>

export function hasRepositoryRole(
	role: RepositoryRole | null,
	minimum: RepositoryRole
): boolean {
	return (
		role !== null && REPOSITORY_ROLE_RANK[role] >= REPOSITORY_ROLE_RANK[minimum]
	)
}

export function canReadRepository(
	role: RepositoryRole | null
): role is RepositoryRole {
	return role !== null
}

export function canWriteRepository(role: RepositoryRole | null): boolean {
	return hasRepositoryRole(role, 'write')
}

export function canAdministerRepository(role: RepositoryRole | null): boolean {
	return hasRepositoryRole(role, 'admin')
}
