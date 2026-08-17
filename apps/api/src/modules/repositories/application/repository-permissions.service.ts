import { Injectable } from '@nestjs/common'
import type { Member } from '@repo/db'
import type {
	RepositoryId,
	RepositoryRole,
	RepositoryVisibility,
	UserId,
} from '@repo/domain'
import type { RepositoryOwnerIdentity } from '../domain/repository'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

export interface RepositoryRoleTarget extends RepositoryOwnerIdentity {
	id: RepositoryId
	visibility: RepositoryVisibility
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
		const implicitRole = await this.resolveImplicitRole(
			viewerUserId,
			repository
		)

		if (implicitRole) return implicitRole

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

	async resolveImplicitRole(
		viewerUserId: UserId | null,
		owner: RepositoryOwnerIdentity
	): Promise<RepositoryRole | null> {
		if (!viewerUserId) return null

		if (owner.ownerUserId)
			return owner.ownerUserId === viewerUserId ? 'owner' : null

		if (owner.ownerOrganizationId) {
			const organizationRole =
				await this.repositoriesRepository.findOrganizationMemberRole({
					organizationId: owner.ownerOrganizationId,
					userId: viewerUserId,
				})

			return mapOrganizationRoleToRepositoryRole(organizationRole)
		}

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
