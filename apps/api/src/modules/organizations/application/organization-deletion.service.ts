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

	/**
	 * Deletes an organization, and says why when it does not.
	 *
	 * Every condition — the organization exists, the actor is an owner, the
	 * typed handle is the handle, nothing is owned — is settled inside one
	 * locked transaction rather than checked here first, because a second owner
	 * renaming the organization or demoting the actor between the check and the
	 * delete would otherwise pass unnoticed. What is left here is turning that
	 * answer into the error the person reads.
	 *
	 * Owners only: `organization:delete` is the one default permission an admin
	 * does not hold, and admins are not told a rename-capable role can also end
	 * the organization.
	 */
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
