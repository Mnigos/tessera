import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { account, and, eq } from '@repo/db'
import { mockUserId } from '~/shared/test-utils'
import { GitHubImportRepository } from './github-import.repository'

describe(GitHubImportRepository.name, () => {
	let moduleRef: TestingModule
	let githubImportRepository: GitHubImportRepository

	const findFirstMock = vi.fn()

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubImportRepository,
				{
					provide: Database,
					useValue: {
						query: {
							account: {
								findFirst: findFirstMock,
							},
						},
					},
				},
			],
		}).compile()

		githubImportRepository = moduleRef.get(GitHubImportRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('finds GitHub account credentials for a user', async () => {
		findFirstMock.mockResolvedValue({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})

		expect(
			await githubImportRepository.findGitHubAccount({ userId: mockUserId })
		).toEqual({
			accessToken: 'github-token',
			scope: 'repo',
			accessTokenExpiresAt: null,
		})
		expect(findFirstMock).toHaveBeenCalledWith({
			where: and(
				eq(account.userId, mockUserId),
				eq(account.providerId, 'github')
			),
			columns: {
				accessToken: true,
				scope: true,
				accessTokenExpiresAt: true,
			},
		})
	})
})
