import type { RepositoryExternalSourceId } from '@repo/db'
import type {
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import {
	type RepositoryWithOwner,
	toRepositoryOutput,
	toRepositoryWithOwner,
} from './repository'

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
				externalSource: { mode: 'none' },
				createdAt: repository.createdAt,
				updatedAt: repository.updatedAt,
			},
			owner: {
				username: 'marta',
			},
		})
	})

	test('maps safe external source metadata to API output', () => {
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
			externalSource: {
				id: '00000000-0000-4000-8000-000000000010' as RepositoryExternalSourceId,
				repositoryId: '00000000-0000-4000-8000-000000000001' as RepositoryId,
				provider: 'github',
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
				mirrorMode: 'github_to_tessera',
				syncStatus: 'succeeded',
				lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
				lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
				lastSyncFailedAt: null,
				nextSyncAt: new Date('2026-05-12T00:16:00Z'),
				syncFailureCount: 0,
				syncFailureReason: null,
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:01:00Z'),
			},
		}

		expect(toRepositoryOutput(repository).repository.externalSource).toEqual({
			mode: 'github_to_tessera',
			provider: 'github',
			externalRepositoryId: '123',
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			syncStatus: 'succeeded',
			lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
			lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
			lastSyncFailedAt: undefined,
			nextSyncAt: new Date('2026-05-12T00:16:00Z'),
			syncFailureReason: undefined,
			createdAt: new Date('2026-05-12T00:00:00Z'),
			updatedAt: new Date('2026-05-12T00:01:00Z'),
		})
	})

	test('rejects rows without owner usernames', () => {
		expect(toRepositoryWithOwner()).toBeUndefined()
		expect(
			toRepositoryWithOwner({
				id: '00000000-0000-4000-8000-000000000001' as RepositoryId,
				ownerUserId: '00000000-0000-4000-8000-000000000002' as UserId,
				ownerOrganizationId: null,
				ownerUser: { username: null },
				slug: 'notes' as RepositorySlug,
				name: 'Notes' as RepositoryName,
				description: null,
				visibility: 'private',
				defaultBranch: 'main',
				storagePath: null,
				createdAt: new Date('2026-05-12T00:00:00Z'),
				updatedAt: new Date('2026-05-12T00:00:00Z'),
			})
		).toBeUndefined()
	})
})
