import type { UserSession } from '@modules/auth'
import { Injectable } from '@nestjs/common'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'

@Injectable()
export class OrganizationsService {
	constructor(
		private readonly organizationsRepository: OrganizationsRepository
	) {}

	async listForViewer(session?: UserSession) {
		if (!session?.user) return { organizations: [] }

		const organizations = await this.organizationsRepository.listForUser(
			session.user.id
		)

		return { organizations }
	}
}
