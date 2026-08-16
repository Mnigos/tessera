import { Injectable } from '@nestjs/common'
import type { Auth } from '@repo/auth'
import type {
	Organization,
	OrganizationMembership,
	OrganizationWithViewerRole,
	ParsedCreateOrganizationInput,
	ParsedGetOrganizationInput,
	ParsedUpdateOrganizationInput,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import {
	betterAuthOrganizationToOutput,
	toOrganizationMembershipOutput,
	toOrganizationOutput,
} from '../domain/organization'
import {
	OrganizationCreateFailedError,
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
		const memberships = await this.organizationsRepository.listMemberships({
			userId,
		})

		return memberships.map(toOrganizationMembershipOutput)
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

			return betterAuthOrganizationToOutput(created)
		} catch (error) {
			throw toOrganizationApiError(error, { slug })
		}
	}

	// Non-members are told the organization does not exist: who belongs to it is
	// not a stranger's to confirm.
	async get(
		viewerUserId: UserId,
		{ organizationId }: ParsedGetOrganizationInput
	): Promise<OrganizationWithViewerRole> {
		const [organization, viewerRole] = await Promise.all([
			this.organizationsRepository.findById({ organizationId }),
			this.organizationsRepository.findMemberRole({
				organizationId,
				userId: viewerUserId,
			}),
		])

		if (!(organization && viewerRole))
			throw new OrganizationNotFoundError({ organizationId })

		return { organization: toOrganizationOutput(organization), viewerRole }
	}

	async update(
		actorUserId: UserId,
		actorHeaders: Record<string, string>,
		{ name, organizationId, slug }: ParsedUpdateOrganizationInput
	): Promise<Organization> {
		const [organization, actorRole] = await Promise.all([
			this.organizationsRepository.findById({ organizationId }),
			this.organizationsRepository.findMemberRole({
				organizationId,
				userId: actorUserId,
			}),
		])

		if (!(organization && actorRole))
			throw new OrganizationNotFoundError({ organizationId })

		// Better Auth makes the authoritative decision below; this one keeps a
		// member from spending a GitHub lookup on a rename that cannot happen.
		if (actorRole === 'member')
			throw new OrganizationPermissionDeniedError({ organizationId, actorRole })

		const nextName = name === organization.name ? undefined : name
		const nextSlug = slug === organization.slug ? undefined : slug

		if (!(nextName || nextSlug)) return toOrganizationOutput(organization)

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

			return betterAuthOrganizationToOutput(updated)
		} catch (error) {
			throw toOrganizationApiError(error, { organizationId, slug: nextSlug })
		}
	}
}
