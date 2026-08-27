import type { RepositoryExternalSourceId } from '@repo/db'
import type { RepositoryId, RepositoryName, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import type { RepositoryWithOwner } from './repository'
import {
	assertGitHubPushBackAvailable,
	assertGitHubPushBackNotRunning,
	assertRepositoryHasStoragePath,
	assertTesseraWritesAllowed,
} from './repository.assertions'
import {
	RepositoryGitHubPushBackInProgressError,
	RepositoryGitHubPushBackUnavailableError,
	RepositoryGitHubSourceOfTruthWriteForbiddenError,
	RepositoryStoragePathMissingError,
} from './repository.errors'

const repository: RepositoryWithOwner = {
	id: '00000000-0000-4000-8000-000000000003' as RepositoryId,
	ownerUserId: mockUserId,
	ownerOrganizationId: null,
	ownerUser: { username: 'marta' },
	slug: 'tessera-notes' as RepositorySlug,
	name: 'Tessera Notes' as RepositoryName,
	description: 'Notes',
	visibility: 'private',
	defaultBranch: 'main',
	storagePath: '/var/lib/tessera/repositories/repo.git',
	createdAt: new Date('2026-05-12T00:00:00Z'),
	updatedAt: new Date('2026-05-12T00:00:00Z'),
}

interface GitHubExternalSourceOverrides {
	githubPushBackStatus?: 'idle' | 'running' | 'succeeded' | 'failed'
	mirrorMode?: 'imported' | 'github_to_tessera' | 'tessera_source'
}

describe('repository assertions', () => {
	test('rejects Tessera writes to GitHub-sourced mirrors', () => {
		expect(() =>
			assertTesseraWritesAllowed({
				...repository,
				externalSource: createGitHubExternalSource({
					mirrorMode: 'github_to_tessera',
				}),
			})
		).toThrow(RepositoryGitHubSourceOfTruthWriteForbiddenError)
	})

	test('only allows push-back for Tessera-sourced GitHub repositories', () => {
		expect(() =>
			assertGitHubPushBackAvailable({
				...repository,
				externalSource: createGitHubExternalSource(),
			})
		).not.toThrow()
		expect(() => assertGitHubPushBackAvailable(repository)).toThrow(
			RepositoryGitHubPushBackUnavailableError
		)
	})

	test('rejects concurrent GitHub push-back operations', () => {
		expect(() =>
			assertGitHubPushBackNotRunning({
				...repository,
				externalSource: createGitHubExternalSource({
					githubPushBackStatus: 'running',
				}),
			})
		).toThrow(RepositoryGitHubPushBackInProgressError)
	})

	test('requires a repository storage path', () => {
		expect(() => assertRepositoryHasStoragePath(repository)).not.toThrow()
		expect(() =>
			assertRepositoryHasStoragePath({ ...repository, storagePath: null })
		).toThrow(RepositoryStoragePathMissingError)
	})
})

function createGitHubExternalSource(
	overrides: GitHubExternalSourceOverrides = {}
): NonNullable<RepositoryWithOwner['externalSource']> {
	return {
		id: '00000000-0000-4000-8000-000000000092' as RepositoryExternalSourceId,
		repositoryId: repository.id,
		provider: 'github' as const,
		externalRepositoryId: 123n,
		ownerLogin: 'marta',
		name: 'notes',
		fullName: 'marta/notes',
		sourceUrl: 'https://github.com/marta/notes',
		sourceDefaultBranch: 'main',
		mirrorMode: 'tessera_source' as const,
		syncStatus: 'succeeded' as const,
		syncProgress: null,
		lastSyncStartedAt: new Date('2026-05-12T00:00:00Z'),
		lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
		lastSyncFailedAt: null,
		nextSyncAt: null,
		syncFailureCount: 0,
		syncFailureReason: null,
		cutoverActorUserId: mockUserId,
		cutoverAt: new Date('2026-05-12T00:01:00Z'),
		cutoverFromMirrorMode: 'github_to_tessera' as const,
		githubPushBackEnabled: false,
		githubPushBackStatus: 'idle' as const,
		githubPushBackStartedAt: null,
		githubPushBackSucceededAt: null,
		githubPushBackFailedAt: null,
		githubPushBackFailureReason: null,
		createdAt: new Date('2026-05-12T00:00:00Z'),
		updatedAt: new Date('2026-05-12T00:00:00Z'),
		...overrides,
	}
}
