import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, apikey, eq } from '@repo/db'
import type { ApiKeyId } from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import { GitAccessTokensRepository } from './git-access-tokens.repository'

const tokenId = '00000000-0000-4000-8000-000000000010' as ApiKeyId

describe(GitAccessTokensRepository.name, () => {
	let moduleRef: TestingModule
	let gitAccessTokensRepository: GitAccessTokensRepository

	const findManyMock = vi.fn()
	const findFirstMock = vi.fn()

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				GitAccessTokensRepository,
				{
					provide: Database,
					useValue: {
						query: {
							apikey: {
								findMany: findManyMock,
								findFirst: findFirstMock,
							},
						},
					},
				},
			],
		}).compile()

		gitAccessTokensRepository = moduleRef.get(GitAccessTokensRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists user-owned git access tokens', async () => {
		findManyMock.mockResolvedValue([{ name: 'Laptop' }])

		expect(
			await gitAccessTokensRepository.list({ userId: mockUserId })
		).toEqual([{ name: 'Laptop' }])
		expect(findManyMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: and(
					eq(apikey.referenceId, mockUserId),
					eq(apikey.configId, 'git-access-tokens'),
					eq(apikey.enabled, true)
				),
			})
		)
	})

	test('finds an owned git access token', async () => {
		findFirstMock.mockResolvedValue({ name: 'Laptop' })

		expect(
			await gitAccessTokensRepository.findOwned({
				userId: mockUserId,
				tokenId,
			})
		).toEqual({ name: 'Laptop' })
		expect(findFirstMock).toHaveBeenCalledWith(
			expect.objectContaining({
				where: and(
					eq(apikey.id, tokenId),
					eq(apikey.referenceId, mockUserId),
					eq(apikey.configId, 'git-access-tokens')
				),
			})
		)
	})
})
