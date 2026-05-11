import type { UserSession } from '@modules/auth'
import { Injectable } from '@nestjs/common'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'

@Injectable()
export class RepositoriesService {
	constructor(
		private readonly repositoriesRepository: RepositoriesRepository
	) {}

	async listForViewer(session?: UserSession) {
		if (!session?.user) return { repositories: [] }

		const repositories = await this.repositoriesRepository.listForUser(
			session.user.id
		)

		return {
			repositories: repositories.map(repository => ({
				id: repository.id,
				ownerSlug:
					repository.ownerOrganizationSlug ??
					repository.ownerUserName ??
					repository.ownerUserDisplayName ??
					'unknown',
				name: repository.name,
				visibility: repository.visibility,
				description: repository.description ?? undefined,
				updatedAt: repository.updatedAt,
			})),
		}
	}
}
