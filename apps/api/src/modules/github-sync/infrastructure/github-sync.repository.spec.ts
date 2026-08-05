import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	GitHubActorId,
	GitHubInstallationId,
	GitHubWebhookDeliveryId,
} from '@repo/db'
import {
	gitHubActors,
	gitHubInstallations,
	gitHubWebhookDeliveries,
	repositoryExternalSources,
} from '@repo/db'
import type { RepositoryId } from '@repo/domain'
import {
	type GitHubInstallationInput,
	GitHubSyncRepository,
} from './github-sync.repository'

const ACTOR_ID = '00000000-0000-4000-8000-000000000121' as GitHubActorId
const INSTALLATION_ID =
	'00000000-0000-4000-8000-000000000122' as GitHubInstallationId
const DELIVERY_ID =
	'00000000-0000-4000-8000-000000000123' as GitHubWebhookDeliveryId
const REPOSITORY_ID = '00000000-0000-4000-8000-000000000124' as RepositoryId
const DELETED_INSTALLATION: GitHubInstallationInput = {
	externalInstallationId: 123n,
	accountNodeId: 'organization-node',
	accountLogin: 'tessera-org',
	targetType: 'organization',
}

describe(GitHubSyncRepository.name, () => {
	let moduleRef: TestingModule
	let repository: GitHubSyncRepository
	const transactionMock = vi.fn()
	const selectMock = vi.fn()
	const updateMock = vi.fn()
	const insertMock = vi.fn()
	const executeMock = vi.fn()
	const valuesMock = vi.fn()
	const onConflictDoNothingMock = vi.fn()
	const onConflictDoUpdateMock = vi.fn()
	const insertReturningMock = vi.fn()
	const installationReturningMock = vi.fn()
	const setMock = vi.fn()
	const updateWhereMock = vi.fn()
	const returningMock = vi.fn()

	function mockExistingInstallationDelivery() {
		selectMock.mockReturnValue({
			from: vi.fn(table => ({
				where: vi.fn(() => ({
					limit: vi
						.fn()
						.mockResolvedValue(
							table === gitHubInstallations ? [{ id: INSTALLATION_ID }] : []
						),
				})),
			})),
		})
		insertReturningMock.mockResolvedValue([{ id: DELIVERY_ID }])
	}

	beforeEach(async () => {
		const transaction = {
			execute: executeMock,
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
		onConflictDoUpdateMock.mockReturnValue({
			returning: installationReturningMock,
		})
		installationReturningMock.mockResolvedValue([
			{ id: INSTALLATION_ID, suspendedAt: null },
		])
		valuesMock.mockReturnValue({
			onConflictDoNothing: onConflictDoNothingMock,
			onConflictDoUpdate: onConflictDoUpdateMock,
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

	test('deletes a full installation and detaches every source', async () => {
		insertReturningMock.mockResolvedValue([{ id: DELIVERY_ID }])

		expect(
			await repository.recordWebhookDelivery({
				deliveryId: DELIVERY_ID,
				eventName: 'installation',
				action: 'deleted',
				installation: DELETED_INSTALLATION,
			})
		).toEqual({ accepted: true, duplicate: false, syncRequests: [] })
		expect(insertMock).toHaveBeenCalledWith(gitHubWebhookDeliveries)
		expect(valuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				id: DELIVERY_ID,
				installationId: undefined,
			})
		)
		expect(setMock).toHaveBeenCalledWith({ installationId: INSTALLATION_ID })
		expect(updateMock).toHaveBeenCalledWith(repositoryExternalSources)
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				installationId: null,
				syncFailureCode: 'missing_installation',
			})
		)
		expect(setMock).toHaveBeenCalledWith({ installationId: null })
		expect(setMock).toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
	})

	test('does not recreate an installation for a duplicate deleted delivery', async () => {
		selectMock.mockReturnValue({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({
						limit: vi.fn().mockResolvedValue([]),
					})),
				})),
			})),
		})

		expect(
			await repository.recordWebhookDelivery({
				deliveryId: DELIVERY_ID,
				eventName: 'installation',
				action: 'deleted',
				installation: DELETED_INSTALLATION,
			})
		).toEqual({ accepted: true, duplicate: true, syncRequests: [] })
		expect(onConflictDoUpdateMock).not.toHaveBeenCalled()
		expect(setMock).not.toHaveBeenCalledWith({ deletedAt: expect.any(Date) })
	})

	test('does not revive a tombstoned installation for a delayed unseen delivery', async () => {
		insertReturningMock.mockResolvedValue([{ id: DELIVERY_ID }])
		selectMock.mockReturnValue({
			from: vi.fn(table => ({
				where: vi.fn(() => ({
					limit: vi.fn().mockResolvedValue(
						table === gitHubInstallations
							? [
									{
										id: INSTALLATION_ID,
										suspendedAt: null,
										deletedAt: new Date('2026-08-05T10:00:00Z'),
									},
								]
							: []
					),
				})),
			})),
		})

		expect(
			await repository.recordWebhookDelivery({
				deliveryId: DELIVERY_ID,
				eventName: 'installation_repositories',
				action: 'added',
				installation: DELETED_INSTALLATION,
				addedInstallationRepositories: [
					{ id: 456, node_id: 'repository-node' },
				],
			})
		).toEqual({ accepted: true, duplicate: false, syncRequests: [] })
		expect(onConflictDoUpdateMock).not.toHaveBeenCalled()
		expect(setMock).not.toHaveBeenCalledWith({
			installationId: INSTALLATION_ID,
		})
	})

	test('blocks synchronized sources for the GitHub suspend action', async () => {
		mockExistingInstallationDelivery()
		const suspendedAt = new Date('2026-08-05T10:00:00Z')

		await repository.recordWebhookDelivery({
			deliveryId: DELIVERY_ID,
			eventName: 'installation',
			action: 'suspend',
			installation: { externalInstallationId: 123n, suspendedAt },
		})

		expect(updateMock).toHaveBeenCalledWith(gitHubInstallations)
		expect(setMock).toHaveBeenCalledWith({ suspendedAt })
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				syncStatus: 'blocked',
				syncFailureCode: 'installation_suspended',
			})
		)
	})

	test('keeps a repository blocked when a normal webhook resolves a suspended installation', async () => {
		const suspendedAt = new Date('2026-08-05T10:00:00Z')
		selectMock.mockReturnValue({
			from: vi.fn(table => ({
				where: vi.fn(() => ({
					limit:
						table === gitHubInstallations
							? vi
									.fn()
									.mockResolvedValue([{ id: INSTALLATION_ID, suspendedAt }])
							: vi.fn(() => ({
									for: vi.fn().mockResolvedValue([
										{
											repositoryId: REPOSITORY_ID,
											mirrorMode: 'github_to_tessera',
											authorityGeneration: 2,
										},
									]),
								})),
				})),
			})),
		})
		insertReturningMock.mockResolvedValue([{ id: DELIVERY_ID }])

		expect(
			await repository.recordWebhookDelivery({
				deliveryId: DELIVERY_ID,
				eventName: 'pull_request',
				action: 'opened',
				installation: { externalInstallationId: 123n },
				externalRepositoryNodeId: 'repository-node',
				externalRepositoryNumericId: 456n,
			})
		).toEqual({ accepted: true, duplicate: false, syncRequests: [] })
		expect(setMock).toHaveBeenCalledWith(
			expect.objectContaining({
				syncStatus: 'blocked',
				syncFailureCode: 'installation_suspended',
			})
		)
		expect(setMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				requestedSyncVersion: expect.anything(),
			})
		)
	})
})
