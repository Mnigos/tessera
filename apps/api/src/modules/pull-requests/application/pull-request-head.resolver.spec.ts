import { GitStorageClient } from '@config/git-storage'
import { Test, type TestingModule } from '@nestjs/testing'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'
import { PullRequestHeadResolver } from './pull-request-head.resolver'

const repositoryId = '00000000-0000-4000-8000-000000000002' as RepositoryId
const headSha = 'b'.repeat(40)
const params = {
	repositoryId,
	storagePath: '/repositories/notes.git',
}
const pullRequest: PullRequestReadModel = {
	id: '00000000-0000-4000-8000-000000000044' as PullRequestId,
	repositoryId,
	provider: 'tessera',
	number: 1,
	authorUserId: mockUserId,
	authorUsername: 'marta',
	sourceBranch: 'feature',
	targetBranch: 'main',
	openingBaseSha: 'a'.repeat(40),
	openingHeadSha: headSha,
	title: 'Feature',
	body: '',
	state: 'open',
	mergeCommitSha: null,
	mergeStrategy: null,
	mergedBaseSha: null,
	mergedHeadSha: null,
	mergeActorUserId: null,
	diffStatsBaseSha: null,
	diffStatsHeadSha: null,
	diffAdditions: null,
	diffDeletions: null,
	diffChangedFiles: null,
	diffCommitCount: null,
	diffStatsUpdatedAt: null,
	createdAt: new Date('2026-08-17T10:00:00Z'),
	updatedAt: new Date('2026-08-17T10:00:00Z'),
	closedAt: null,
	mergedAt: null,
	github: undefined,
}

describe(PullRequestHeadResolver.name, () => {
	let moduleRef: TestingModule
	let resolver: PullRequestHeadResolver
	let gitStorageClient: GitStorageClient

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				PullRequestHeadResolver,
				{
					provide: GitStorageClient,
					useValue: {
						listRepositoryRefs: vi.fn(),
						compareRepositoryRefs: vi.fn(),
					},
				},
			],
		}).compile()

		resolver = moduleRef.get(PullRequestHeadResolver)
		gitStorageClient = moduleRef.get(GitStorageClient)
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: headSha,
				},
			],
			tags: [],
		})
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('uses a mirrored pull request mapping without reading refs', async () => {
		expect(
			await resolver.resolveComparisonHeadSha({
				...params,
				pullRequest: {
					...pullRequest,
					provider: 'github',
					authorUserId: null,
					github: {
						nodeId: 'PR_kwDOExample',
						htmlUrl: 'https://github.com/marta/notes/pull/7',
						draft: false,
						headSha: 'c'.repeat(40),
						baseSha: 'a'.repeat(40),
						externalNumber: 7,
					},
				},
			})
		).toBe('c'.repeat(40))
		expect(gitStorageClient.listRepositoryRefs).not.toHaveBeenCalled()
	})

	test('uses the stored source parent for merged pull requests', async () => {
		expect(
			await resolver.resolveComparisonHeadSha({
				...params,
				pullRequest: {
					...pullRequest,
					state: 'merged',
					mergedHeadSha: 'd'.repeat(40),
				},
			})
		).toBe('d'.repeat(40))
		expect(gitStorageClient.listRepositoryRefs).not.toHaveBeenCalled()
	})

	test('falls back to current-head resolution for legacy merged rows', async () => {
		const resolveCurrentHeadShaSpy = vi
			.spyOn(resolver, 'resolveCurrentHeadSha')
			.mockResolvedValue('e'.repeat(40))
		const legacy = { ...pullRequest, state: 'merged' as const }

		expect(
			await resolver.resolveComparisonHeadSha({
				...params,
				pullRequest: legacy,
			})
		).toBe('e'.repeat(40))
		expect(resolveCurrentHeadShaSpy).toHaveBeenCalledWith({
			...params,
			pullRequest: legacy,
		})
	})

	test.each([
		'open',
		'closed',
	] as const)('resolves a %s native pull request from the branch tip', async state => {
		expect(
			await resolver.resolveComparisonHeadSha({
				...params,
				pullRequest: { ...pullRequest, state },
			})
		).toBe(headSha)
		expect(gitStorageClient.listRepositoryRefs).toHaveBeenCalledWith({
			...params,
			trustedGpgKeys: [],
		})
	})

	test('returns undefined when the source branch is absent', async () => {
		vi.spyOn(gitStorageClient, 'listRepositoryRefs').mockResolvedValue({
			branches: [],
			tags: [],
		})

		expect(
			await resolver.resolveComparisonHeadSha({ ...params, pullRequest })
		).toBeUndefined()
	})
})
