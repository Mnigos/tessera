import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type { GitHubActorId } from '@repo/db'
import { gitHubActors } from '@repo/db'
import { GitHubSyncRepository } from './github-sync.repository'

const ACTOR_ID = '00000000-0000-4000-8000-000000000121' as GitHubActorId

describe(GitHubSyncRepository.name, () => {
	let moduleRef: TestingModule
	let repository: GitHubSyncRepository
	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const updateMock = vi.fn()
	const insertMock = vi.fn()
	const valuesMock = vi.fn()
	const onConflictDoNothingMock = vi.fn()
	const insertReturningMock = vi.fn()
	const setMock = vi.fn()
	const updateWhereMock = vi.fn()
	const returningMock = vi.fn()

	beforeEach(async () => {
		const transaction = {
			select: selectMock,
			update: updateMock,
			insert: insertMock,
		}
		transactionMock.mockImplementation(callback => callback(transaction))
		selectMock.mockReturnValue({
			from: vi.fn(table => ({
				where: vi.fn(() => ({
					limit: vi
						.fn()
						.mockResolvedValue(
							table === gitHubActors ? [{ id: ACTOR_ID }] : []
						),
				})),
			})),
		})
		returningMock.mockResolvedValue([{ id: ACTOR_ID }])
		updateWhereMock.mockReturnValue({ returning: returningMock })
		setMock.mockReturnValue({ where: updateWhereMock })
		updateMock.mockReturnValue({ set: setMock })
		insertReturningMock.mockResolvedValue([])
		onConflictDoNothingMock.mockReturnValue({ returning: insertReturningMock })
		valuesMock.mockReturnValue({
			onConflictDoNothing: onConflictDoNothingMock,
		})
		insertMock.mockReturnValue({ values: valuesMock })

		moduleRef = await Test.createTestingModule({
			providers: [
				GitHubSyncRepository,
				{
					provide: Database,
					useValue: { transaction: transactionMock },
				},
			],
		}).compile()
		repository = moduleRef.get(GitHubSyncRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('updates the actor found by numeric id when its node id changes', async () => {
		expect(
			await repository.upsertActors([
				{
					nodeId: 'new-node-id',
					numericId: 7n,
					login: 'marta',
					type: 'user',
				},
			])
		).toEqual(new Map([['new-node-id', ACTOR_ID]]))
		expect(updateMock).toHaveBeenCalledWith(gitHubActors)
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				externalNodeId: 'new-node-id',
				externalNumericId: 7n,
			})
		)
		expect(insertMock).toHaveBeenCalledWith(gitHubActors)
		expect(onConflictDoNothingMock).toHaveBeenCalledOnce()
	})
})
