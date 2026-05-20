import type { RepositoryImportId } from '@repo/db'
import type { RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	hasGitHubRepoScope,
	toGitHubRepositoryImport,
} from './github-import.helpers'

describe('github import helpers', () => {
	test('detects repo scope in comma and space separated scope strings', () => {
		expect(hasGitHubRepoScope('read:user repo')).toBe(true)
		expect(hasGitHubRepoScope('read:user,user:email,repo')).toBe(true)
		expect(hasGitHubRepoScope('read:user user:email')).toBe(false)
	})

	test('maps repository import rows to contract output', () => {
		const createdAt = new Date('2026-05-19T00:00:00.000Z')
		const updatedAt = new Date('2026-05-19T00:01:00.000Z')

		expect(
			toGitHubRepositoryImport({
				id: '00000000-0000-4000-8000-000000000029' as RepositoryImportId,
				ownerUserId: mockUserId,
				repositoryId: null,
				provider: 'github',
				targetName: 'Tessera',
				targetSlug: 'tessera' as RepositorySlug,
				sourceGithubId: 123n,
				sourceOwnerLogin: 'mnigos',
				sourceName: 'tessera',
				sourceFullName: 'mnigos/tessera',
				sourceVisibility: 'private',
				sourceDefaultBranch: 'main',
				sourceGithubUrl: 'https://github.com/mnigos/tessera',
				status: 'pending',
				failureReason: null,
				startedAt: null,
				completedAt: null,
				createdAt,
				updatedAt,
			})
		).toEqual({
			id: '00000000-0000-4000-8000-000000000029',
			repositoryId: undefined,
			provider: 'github',
			targetName: 'Tessera',
			targetSlug: 'tessera',
			source: {
				githubId: '123',
				ownerLogin: 'mnigos',
				name: 'tessera',
				fullName: 'mnigos/tessera',
				visibility: 'private',
				defaultBranch: 'main',
				githubUrl: 'https://github.com/mnigos/tessera',
			},
			status: 'pending',
			failureReason: undefined,
			startedAt: undefined,
			completedAt: undefined,
			createdAt,
			updatedAt,
		})
	})
})
