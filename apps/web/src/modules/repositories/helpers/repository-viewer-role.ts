import type { RepositoryViewerRole } from '@repo/contracts'
import { canAdministerRepository, canWriteRepository } from '@repo/domain'

export { canAdministerRepository, canWriteRepository }

export function isRepositoryOwner(
	role: RepositoryViewerRole | undefined
): boolean {
	return role === 'owner'
}
