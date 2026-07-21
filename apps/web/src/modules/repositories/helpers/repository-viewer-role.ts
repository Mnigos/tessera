import type { RepositoryViewerRole } from '@repo/contracts'

export function canWriteRepository(
	role: RepositoryViewerRole | null | undefined
): boolean {
	return role === 'owner' || role === 'admin' || role === 'write'
}

export function canAdministerRepository(
	role: RepositoryViewerRole | null | undefined
): boolean {
	return role === 'owner' || role === 'admin'
}

export function isRepositoryOwner(
	role: RepositoryViewerRole | null | undefined
): boolean {
	return role === 'owner'
}
