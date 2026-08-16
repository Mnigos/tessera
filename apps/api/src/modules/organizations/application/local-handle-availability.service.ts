import { Injectable } from '@nestjs/common'
import type { OrganizationId } from '@repo/domain'
import { OrganizationHandlePolicyRepository } from '../infrastructure/organization-handle-policy.repository'

/**
 * The local half of the handle policy: whether Tessera itself already answers
 * to a handle.
 *
 * It is a collaborator of its own rather than a step inside the policy so that
 * TES-61 can replace how local uniqueness is decided — database constraint
 * instead of a read — without the GitHub half or its callers changing.
 */
@Injectable()
export class LocalHandleAvailabilityService {
	constructor(
		private readonly handlePolicyRepository: OrganizationHandlePolicyRepository
	) {}

	/**
	 * Whether a user or an organization already holds the handle.
	 *
	 * The query lowercases both sides, so the answer does not depend on how the
	 * caller cased the slug. `ignoreOrganizationId` excludes one organization,
	 * which is how a rename avoids colliding with itself.
	 */
	async isTaken(
		slug: string,
		ignoreOrganizationId?: OrganizationId
	): Promise<boolean> {
		return await this.handlePolicyRepository.isHandleTaken({
			handle: slug.trim(),
			ignoreOrganizationId,
		})
	}
}
