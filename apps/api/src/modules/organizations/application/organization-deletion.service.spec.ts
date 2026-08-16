import { Test, type TestingModule } from '@nestjs/testing'
import type { OrganizationId, UserId } from '@repo/domain'
import {
	OrganizationDeleteConfirmationError,
	OrganizationHasRepositoriesError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { OrganizationDeletionService } from './organization-deletion.service'

const actorUserId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const input = { organizationId, confirmationSlug: 'tessera' }

describe(OrganizationDeletionService.name, () => {
	let moduleRef: TestingModule
	let service: OrganizationDeletionService
	let repository: OrganizationsRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationDeletionService,
				{
					provide: OrganizationsRepository,
					useValue: {
						deleteOwned: vi.fn().mockResolvedValue({ kind: 'deleted' }),
					},
				},
			],
		}).compile()

		service = moduleRef.get(OrganizationDeletionService)
		repository = moduleRef.get(OrganizationsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('delegates all deletion checks to the transactional repository', async () => {
		const deleteOwnedSpy = vi.spyOn(repository, 'deleteOwned')

		expect(await service.delete(actorUserId, input)).toBeUndefined()
		expect(deleteOwnedSpy).toHaveBeenCalledWith({
			organizationId,
			userId: actorUserId,
			confirmationSlug: 'tessera',
		})
	})

	test('maps a missing organization or membership to not found', async () => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({ kind: 'not-found' })

		await expect(service.delete(actorUserId, input)).rejects.toBeInstanceOf(
			OrganizationNotFoundError
		)
	})

	test.each([
		'admin',
		'member',
	] as const)('refuses deletion by a %s', async role => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({
			kind: 'forbidden',
			actorRole: role,
		})

		await expect(service.delete(actorUserId, input)).rejects.toBeInstanceOf(
			OrganizationPermissionDeniedError
		)
	})

	test('maps a confirmation mismatch to a bad request', async () => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({
			kind: 'confirmation-mismatch',
		})

		await expect(service.delete(actorUserId, input)).rejects.toBeInstanceOf(
			OrganizationDeleteConfirmationError
		)
	})

	test('reports the repository count when deletion is blocked', async () => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({
			kind: 'has-repositories',
			repositoryCount: 2,
		})

		const promise = service.delete(actorUserId, input)

		await expect(promise).rejects.toBeInstanceOf(
			OrganizationHasRepositoriesError
		)
		await expect(promise).rejects.toMatchObject({
			context: expect.objectContaining({ repositoryCount: 2 }),
		})
	})
})
