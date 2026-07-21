import { repositoryCollaboratorRoles } from './repository-collaborator-role'

export const repositoryRoles = [
	...repositoryCollaboratorRoles,
	'owner',
] as const

export type RepositoryRole = (typeof repositoryRoles)[number]

const REPOSITORY_ROLE_RANK = {
	read: 0,
	write: 1,
	admin: 2,
	owner: 3,
} as const satisfies Record<RepositoryRole, number>

export function hasRepositoryRole(
	role: RepositoryRole | null | undefined,
	minimum: RepositoryRole
): boolean {
	return (
		role != null && REPOSITORY_ROLE_RANK[role] >= REPOSITORY_ROLE_RANK[minimum]
	)
}

export function canReadRepository(
	role: RepositoryRole | null | undefined
): role is RepositoryRole {
	return role != null
}

export function canWriteRepository(
	role: RepositoryRole | null | undefined
): boolean {
	return hasRepositoryRole(role, 'write')
}

export function canAdministerRepository(
	role: RepositoryRole | null | undefined
): boolean {
	return hasRepositoryRole(role, 'admin')
}
