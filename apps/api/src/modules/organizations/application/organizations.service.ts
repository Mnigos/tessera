import { Injectable } from '@nestjs/common'
import type { Auth } from '@repo/auth'
import type {
	Organization,
	OrganizationMembership,
	OrganizationWithViewerRole,
	ParsedCreateOrganizationInput,
	ParsedDeleteOrganizationInput,
	ParsedGetOrganizationInput,
	ParsedUpdateOrganizationInput,
} from '@repo/contracts'
import type { OrganizationId, UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { InternalError } from '~/shared/errors'
import { toOrganization } from '../domain/organization'
import {
	OrganizationCreateFailedError,
	OrganizationDeleteConfirmationError,
	OrganizationHasRepositoriesError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import { toOrganizationApiError } from '../helpers/better-auth-organization-error'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { OrganizationHandlePolicyService } from './organization-handle-policy.service'

@Injectable()
export class OrganizationsService {
	constructor(
		private readonly betterAuthService: BetterAuthService<Auth>,
		private readonly organizationsRepository: OrganizationsRepository,
		private readonly organizationHandlePolicyService: OrganizationHandlePolicyService
	) {}

	async list(userId: UserId): Promise<OrganizationMembership[]> {
		return await this.organizationsRepository.listMemberships({ userId })
	}

	async create(
		actorUserId: UserId,
		{ name, slug }: ParsedCreateOrganizationInput
	): Promise<Organization> {
		await this.organizationHandlePolicyService.assertAvailable({
			slug,
			actorUserId,
		})

		try {
			// Headerless, so Better Auth reads this as a system action and skips
			// `allowUserToCreateOrganization`; a future creation gate belongs here.
			const created = await this.betterAuthService.api.createOrganization({
				body: {
					name,
					slug,
					userId: actorUserId,
					keepCurrentActiveOrganization: true,
				},
			})

			if (!created) throw new OrganizationCreateFailedError({ slug })

			return toOrganization(created)
		} catch (error) {
			throw toOrganizationApiError(error, { slug })
		}
	}

	async get(
		viewerUserId: UserId,
		{ organizationId }: ParsedGetOrganizationInput
	): Promise<OrganizationWithViewerRole> {
		const { organization, role } = await this.requireMembership(
			organizationId,
			viewerUserId
		)

		return { organization, viewerRole: role }
	}

	async update(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ name, organizationId, slug }: ParsedUpdateOrganizationInput
	): Promise<Organization> {
		const { organization, role } = await this.requireMembership(
			organizationId,
			actorUserId
		)

		// Better Auth makes the authoritative decision below; this one keeps a
		// member from spending a GitHub lookup on a rename that cannot happen.
		if (role === 'member')
			throw new OrganizationPermissionDeniedError({
				organizationId,
				actorRole: role,
			})

		const nextName = name === organization.name ? undefined : name
		const nextSlug = slug === organization.slug ? undefined : slug

		if (!(nextName || nextSlug)) return organization

		if (nextSlug)
			await this.organizationHandlePolicyService.assertAvailable({
				slug: nextSlug,
				actorUserId,
				ignoreOrganizationId: organizationId,
			})

		try {
			const updated = await this.betterAuthService.api.updateOrganization({
				body: {
					organizationId,
					data: { name: nextName, slug: nextSlug },
				},
				headers: actorHeaders,
			})

			if (!updated) throw new OrganizationNotFoundError({ organizationId })

			return toOrganization(updated)
		} catch (error) {
			throw toOrganizationApiError(error, { organizationId, slug: nextSlug })
		}
	}

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
			case 'has-repositories':
				throw new OrganizationHasRepositoriesError(result.repositoryCount, {
					organizationId,
				})
			default:
				// Unreachable: a deletion outcome added without a branch above fails
				// typecheck here, and at runtime it must not report success.
				result satisfies never

				throw new InternalError('organization delete', { organizationId })
		}
	}

	// Non-members are told the organization does not exist: who belongs to it is
	// not a stranger's to confirm.
	private async requireMembership(
		organizationId: OrganizationId,
		userId: UserId
	) {
		const [organization, role] = await Promise.all([
			this.organizationsRepository.findById({ organizationId }),
			this.organizationsRepository.findMemberRole({ organizationId, userId }),
		])

		if (!(organization && role))
			throw new OrganizationNotFoundError({ organizationId })

		return { organization, role }
	}
}
