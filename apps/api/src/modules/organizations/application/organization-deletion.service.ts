import { Injectable } from '@nestjs/common'
import type { ParsedDeleteOrganizationInput } from '@repo/contracts'
import type { UserId } from '@repo/domain'
import {
	OrganizationDeleteConfirmationError,
	OrganizationHasRepositoriesError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'

@Injectable()
export class OrganizationDeletionService {
	constructor(
		private readonly organizationsRepository: OrganizationsRepository
	) {}

	async delete(
		actorUserId: UserId,
		{ confirmationSlug, organizationId }: ParsedDeleteOrganizationInput
	): Promise<void> {
		const result = await this.organizationsRepository.deleteOwned({
			organizationId,
			userId: actorUserId,
			confirmationSlug,
		})

		switch (result.kind) {
			case 'deleted':
				return
			case 'not-found':
				throw new OrganizationNotFoundError({ organizationId })
			case 'forbidden':
				throw new OrganizationPermissionDeniedError({
					organizationId,
					actorRole: result.actorRole,
				})
			case 'confirmation-mismatch':
				throw new OrganizationDeleteConfirmationError({ organizationId })
			default:
				throw new OrganizationHasRepositoriesError(result.repositoryCount, {
					organizationId,
				})
		}
	}
}
