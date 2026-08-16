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
import type { OrganizationId, UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import {
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

/** What Better Auth needs to evaluate the caller rather than the server. */
type ActorHeaders = Record<string, string>

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

	/**
	 * The handle is settled before Better Auth is asked to write anything, so a
	 * handle Tessera would refuse never becomes an organization row that a later
	 * check has to undo.
	 */
	async create(
		actorUserId: UserId,
		{ name, slug }: ParsedCreateOrganizationInput
	): Promise<Organization> {
		await this.organizationHandlePolicyService.assertAvailable({
			slug,
			actorUserId,
		})

		try {
			// No headers: naming the creator is enough here, and Better Auth makes
			// them the owner of what it creates. Better Auth reads a headerless
			// call as a system action and skips `allowUserToCreateOrganization`,
			// which Tessera leaves at its default of allowing everyone; a future
			// creation gate has to be applied here rather than configured there.
			const created = await this.betterAuthService.api.createOrganization({
				body: {
					name,
					slug,
					userId: actorUserId,
					keepCurrentActiveOrganization: true,
				},
			})

			if (!created) throw new OrganizationCreateFailedError({ slug })

			return toOrganizationOutput({
				id: created.id as OrganizationId,
				slug: created.slug,
				name: created.name,
				logo: created.logo ?? null,
				createdAt: created.createdAt,
			})
		} catch (error) {
			throw toOrganizationApiError(error, { slug })
		}
	}

	/**
	 * Members only, and a non-member is told the organization does not exist:
	 * the handle namespace is public, but who belongs to a private organization
	 * is not, and a 403 would answer that question.
	 */
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

	/**
	 * Rename re-runs the whole handle policy, because a slug is claimed here on
	 * exactly the same terms as at creation.
	 */
	async update(
		actorUserId: UserId,
		actorHeaders: ActorHeaders,
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

		// Better Auth makes the authoritative decision below, from the caller's
		// own session. This one is here so a member cannot spend a GitHub handle
		// lookup on a rename that was never going to be allowed.
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
			// Forwarded headers, so the role check runs against the caller's real
			// session instead of a user id this service asserted.
			const updated = await this.betterAuthService.api.updateOrganization({
				body: {
					organizationId,
					data: { name: nextName, slug: nextSlug },
				},
				headers: actorHeaders,
			})

			if (!updated) throw new OrganizationNotFoundError({ organizationId })

			return toOrganizationOutput({
				id: updated.id as OrganizationId,
				slug: updated.slug,
				name: updated.name,
				logo: updated.logo ?? null,
				createdAt: updated.createdAt,
			})
		} catch (error) {
			throw toOrganizationApiError(error, { organizationId, slug: nextSlug })
		}
	}
}
