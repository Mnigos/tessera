import { Injectable } from '@nestjs/common'
import type { Member } from '@repo/db'
import type {
	OrganizationId,
	RepositoryId,
	RepositoryVisibility,
	UserId,
} from '@repo/domain'
import type { RepositoryRole } from '../domain/repository-role'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

export interface RepositoryRoleTarget {
	id: RepositoryId
	visibility: RepositoryVisibility
	ownerUserId: UserId | null
	ownerOrganizationId: OrganizationId | null
}

@Injectable()
export class RepositoryPermissionsService {
	constructor(
		private readonly repositoriesRepository: RepositoriesRepository
	) {}

	async resolveRole(
		viewerUserId: UserId | null,
		repository: RepositoryRoleTarget
	): Promise<RepositoryRole | null> {
		if (repository.ownerUserId) {
			if (viewerUserId && repository.ownerUserId === viewerUserId)
				return 'owner'
		} else if (repository.ownerOrganizationId && viewerUserId) {
			const organizationRole =
				await this.repositoriesRepository.findOrganizationMemberRole({
					organizationId: repository.ownerOrganizationId,
					userId: viewerUserId,
				})
			const mappedRole = mapOrganizationRoleToRepositoryRole(organizationRole)

			if (mappedRole) return mappedRole
		}

		if (viewerUserId) {
			const collaboratorRole =
				await this.repositoriesRepository.findCollaboratorRole({
					repositoryId: repository.id,
					userId: viewerUserId,
				})

			if (collaboratorRole) return collaboratorRole
		}

		if (repository.visibility === 'public') return 'read'

		return null
	}
}

function mapOrganizationRoleToRepositoryRole(
	role: Member['role'] | undefined
): RepositoryRole | null {
	switch (role) {
		case 'owner':
		case 'admin':
			return 'admin'
		default:
			return null
	}
}
