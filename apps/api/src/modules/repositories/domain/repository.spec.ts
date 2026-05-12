import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { type RepositoryWithOwner, toRepositoryOutput } from './repository'

describe('repository domain mapper', () => {
	test('maps persistence nulls to optional API fields', () => {
		const repository: RepositoryWithOwner = {
			id: '00000000-0000-4000-8000-000000000001' as RepositoryId,
			ownerUserId: '00000000-0000-4000-8000-000000000002' as UserId,
			ownerOrganizationId: null,
			ownerUser: { username: 'marta' },
			slug: 'notes' as RepositorySlug,
			name: 'Notes' as RepositoryName,
			description: null,
			visibility: 'private',
			defaultBranch: 'main',
			storagePath: null,
			createdAt: new Date('2026-05-12T00:00:00Z'),
			updatedAt: new Date('2026-05-12T00:00:00Z'),
		}

		expect(toRepositoryOutput(repository)).toEqual({
			repository: {
				id: repository.id,
				slug: repository.slug,
				name: repository.name,
				visibility: 'private',
				description: undefined,
				defaultBranch: 'main',
				storagePath: undefined,
				createdAt: repository.createdAt,
				updatedAt: repository.updatedAt,
			},
			owner: {
				username: 'marta',
			},
		})
	})
})
