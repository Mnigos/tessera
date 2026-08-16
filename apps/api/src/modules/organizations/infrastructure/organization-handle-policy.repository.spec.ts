import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type { OrganizationId, UserId } from '@repo/domain'
import { OrganizationHandlePolicyRepository } from './organization-handle-policy.repository'

const userId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId

function selectResult(rows: object[]) {
	return {
		from: vi.fn(() => ({
			where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue(rows) })),
		})),
	}
}

describe(OrganizationHandlePolicyRepository.name, () => {
	let moduleRef: TestingModule
	let repository: OrganizationHandlePolicyRepository
	const select = vi.fn()
	const findFirst = vi.fn()

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationHandlePolicyRepository,
				{
					provide: Database,
					useValue: {
						select,
						query: { account: { findFirst } },
					},
				},
			],
		}).compile()

		repository = moduleRef.get(OrganizationHandlePolicyRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test.each([
		['username', [{ id: userId }], []],
		['organization slug', [], [{ id: organizationId }]],
	] as const)('reports a taken %s', async (_label, users, organizations) => {
		select
			.mockReturnValueOnce(selectResult([...users]))
			.mockReturnValueOnce(selectResult([...organizations]))

		expect(await repository.isHandleTaken({ handle: 'TeSsErA' })).toBe(true)
	})

	test('reports an available handle and accepts a rename exclusion', async () => {
		select
			.mockReturnValueOnce(selectResult([]))
			.mockReturnValueOnce(selectResult([]))

		expect(
			await repository.isHandleTaken({
				handle: 'tessera-next',
				ignoreOrganizationId: organizationId,
			})
		).toBe(false)
		expect(select).toHaveBeenCalledTimes(2)
	})

	test('loads the newest linked GitHub account identity', async () => {
		const identity = {
			accountId: '42',
			accessToken: 'github-token',
			accessTokenExpiresAt: null,
		}
		findFirst.mockResolvedValue(identity)

		expect(await repository.findGitHubAccount({ userId })).toEqual(identity)
		expect(findFirst).toHaveBeenCalledWith(
			expect.objectContaining({
				columns: {
					accountId: true,
					accessToken: true,
					accessTokenExpiresAt: true,
				},
			})
		)
	})
})
