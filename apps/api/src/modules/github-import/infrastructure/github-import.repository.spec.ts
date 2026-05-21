import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type { RepositoryImportId } from '@repo/db'
import {
	account,
	and,
	eq,
	inArray,
	isNotNull,
	repositories,
	repositoryImports,
} from '@repo/db'
import type { RepositoryId, RepositorySlug } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { GitHubImportRepository } from './github-import.repository'

describe(GitHubImportRepository.name, () => {
	let moduleRef: TestingModule
	let githubImportRepository: GitHubImportRepository

	const findFirstMock = vi.fn()
	const findFirstImportMock = vi.fn()
	const findFirstRepositoryMock = vi.fn()
	const updateMock = vi.fn()
	const setMock = vi.fn()
	const whereMock = vi.fn()
	const updateReturningMock = vi.fn()

	beforeEach(async () => {
		updateReturningMock.mockResolvedValue([])
		whereMock.mockReturnValue({ returning: updateReturningMock })
		setMock.mockReturnValue({ where: whereMock })
		updateMock.mockReturnValue({ set: setMock })
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
							repositoryImports: {
								findFirst: findFirstImportMock,
							},
							repositories: {
								findFirst: findFirstRepositoryMock,
							},
						},
						update: updateMock,
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

	test('checks active imports for a GitHub source', async () => {
		findFirstImportMock.mockResolvedValue({
			id: '00000000-0000-4000-8000-000000000029',
		})

		expect(
			await githubImportRepository.hasActiveSource({
				userId: mockUserId,
				githubId: '123',
			})
		).toBeTruthy()
		expect(findFirstImportMock).toHaveBeenCalledWith({
			where: and(
				eq(repositoryImports.ownerUserId, mockUserId),
				eq(repositoryImports.sourceGithubId, 123n),
				inArray(repositoryImports.status, ['pending', 'running', 'succeeded'])
			),
			columns: { id: true },
		})
	})

	test('checks active imports for a target slug', async () => {
		findFirstImportMock.mockResolvedValue(undefined)

		expect(
			await githubImportRepository.hasActiveTargetSlug({
				userId: mockUserId,
				targetSlug: 'tessera' as RepositorySlug,
			})
		).toBeFalsy()
		expect(findFirstImportMock).toHaveBeenCalledWith({
			where: and(
				eq(repositoryImports.ownerUserId, mockUserId),
				eq(repositoryImports.targetSlug, 'tessera' as RepositorySlug),
				inArray(repositoryImports.status, ['pending', 'running', 'succeeded'])
			),
			columns: { id: true },
		})
	})

	test('checks only storage-backed repositories for a target slug', async () => {
		findFirstRepositoryMock.mockResolvedValue(undefined)

		expect(
			await githubImportRepository.hasRepositoryTargetSlug({
				userId: mockUserId,
				targetSlug: 'tessera' as RepositorySlug,
			})
		).toBeFalsy()
		expect(findFirstRepositoryMock).toHaveBeenCalledWith({
			where: and(
				eq(repositories.ownerUserId, mockUserId),
				eq(repositories.slug, 'tessera' as RepositorySlug),
				isNotNull(repositories.storagePath)
			),
			columns: { id: true },
		})
	})

	test('only marks pending or running imports as running', async () => {
		const importId =
			'00000000-0000-4000-8000-000000000029' as RepositoryImportId

		await githubImportRepository.markRunning({ importId })

		expect(updateMock).toHaveBeenCalledWith(repositoryImports)
		expect(setMock).toHaveBeenCalledWith({
			status: 'running',
			startedAt: expect.any(Date),
			failureReason: null,
		})
		expect(whereMock).toHaveBeenCalledWith(
			and(
				eq(repositoryImports.id, importId),
				inArray(repositoryImports.status, ['pending', 'running'])
			)
		)
	})

	test('only marks pending or running imports as succeeded', async () => {
		const importId =
			'00000000-0000-4000-8000-000000000029' as RepositoryImportId

		await githubImportRepository.markSucceeded({
			importId,
			repositoryId: '00000000-0000-4000-8000-000000000030' as RepositoryId,
		})

		expect(updateMock).toHaveBeenCalledWith(repositoryImports)
		expect(setMock).toHaveBeenCalledWith({
			status: 'succeeded',
			completedAt: expect.any(Date),
			repositoryId: '00000000-0000-4000-8000-000000000030',
			failureReason: null,
		})
		expect(whereMock).toHaveBeenCalledWith(
			and(
				eq(repositoryImports.id, importId),
				inArray(repositoryImports.status, ['pending', 'running'])
			)
		)
	})

	test('only links pending or running imports to repository metadata', async () => {
		const importId =
			'00000000-0000-4000-8000-000000000029' as RepositoryImportId

		await githubImportRepository.markRepositoryMetadata({
			importId,
			repositoryId: '00000000-0000-4000-8000-000000000030' as RepositoryId,
		})

		expect(updateMock).toHaveBeenCalledWith(repositoryImports)
		expect(setMock).toHaveBeenCalledWith({
			repositoryId: '00000000-0000-4000-8000-000000000030',
		})
		expect(whereMock).toHaveBeenCalledWith(
			and(
				eq(repositoryImports.id, importId),
				inArray(repositoryImports.status, ['pending', 'running'])
			)
		)
	})

	test('only marks pending or running imports as failed', async () => {
		const importId =
			'00000000-0000-4000-8000-000000000029' as RepositoryImportId

		await githubImportRepository.markFailed({
			importId,
			failureReason: 'clone failed',
		})

		expect(updateMock).toHaveBeenCalledWith(repositoryImports)
		expect(setMock).toHaveBeenCalledWith({
			status: 'failed',
			completedAt: expect.any(Date),
			failureReason: 'clone failed',
		})
		expect(whereMock).toHaveBeenCalledWith(
			and(
				eq(repositoryImports.id, importId),
				inArray(repositoryImports.status, ['pending', 'running'])
			)
		)
	})
})
