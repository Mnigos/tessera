import { OrganizationsRepository } from '@modules/organizations'
import { RepositoriesRepository } from '@modules/repositories/infrastructure/repositories.repository'
import { UserService } from '@modules/user'
import { Injectable } from '@nestjs/common'
import type { HandleProfile, ParsedHandleInput } from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { HandleNotFoundError } from '../domain/handle.errors'

@Injectable()
export class HandlesService {
	constructor(
		private readonly organizationsRepository: OrganizationsRepository,
		private readonly repositoriesRepository: RepositoriesRepository,
		private readonly userService: UserService
	) {}

	async get(
		viewerUserId: UserId | undefined,
		{ handle }: ParsedHandleInput
	): Promise<HandleProfile> {
		const [profileUser, profileOrganization] = await Promise.all([
			this.userService.findPublicUser({ username: handle }),
			this.organizationsRepository.findBySlug({ slug: handle }),
		])

		// Usernames and organization slugs are separate namespaces, so both can
		// hold the same handle; the user wins.
		if (profileUser)
			return {
				owner: {
					kind: 'user',
					user: profileUser,
					viewerRole: profileUser.id === viewerUserId ? 'self' : undefined,
				},
				repositories: await this.repositoriesRepository.listVisibleByOwner({
					ownerUserId: profileUser.id,
					viewerUserId,
				}),
			}

		if (!profileOrganization) throw new HandleNotFoundError(handle)

		return {
			owner: {
				kind: 'organization',
				organization: profileOrganization,
				viewerRole: viewerUserId
					? await this.organizationsRepository.findMemberRole({
							organizationId: profileOrganization.id,
							userId: viewerUserId,
						})
					: undefined,
			},
			repositories: await this.repositoriesRepository.listVisibleByOwner({
				ownerOrganizationId: profileOrganization.id,
				viewerUserId,
			}),
		}
	}
}
