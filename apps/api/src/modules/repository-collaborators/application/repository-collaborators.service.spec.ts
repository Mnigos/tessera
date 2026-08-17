import {
	RepositoriesService,
	RepositoryPermissionsService,
} from '@modules/repositories'
import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	OrganizationId,
	RepositoryId,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { mockUserId } from '~/shared/test-utils'
import {
	RepositoryCollaboratorImplicitAccessError,
	RepositoryCollaboratorNotFoundError,
	RepositoryCollaboratorOwnerError,
} from '../domain/repository-collaborator.errors'
import { RepositoryCollaboratorsRepository } from '../infrastructure/repository-collaborators.repository'
import { RepositoryCollaboratorsService } from './repository-collaborators.service'

const repositoryId = '00000000-0000-4000-8000-000000000011' as RepositoryId
const ownerUserId = '00000000-0000-4000-8000-000000000012' as UserId
const collaboratorUserId = '00000000-0000-4000-8000-000000000013' as UserId
const ownerOrganizationId =
	'00000000-0000-4000-8000-000000000014' as OrganizationId

const addInput = {
	username: 'marta',
	slug: 'notes' as RepositorySlug,
	collaboratorUsername: 'ren',
	role: 'write' as const,
}

const managementContext = {
	repositoryId,
	visibility: 'private' as const,
	ownerUserId,
	ownerOrganizationId: null,
}

describe(RepositoryCollaboratorsService.name, () => {
	let moduleRef: TestingModule
	let service: RepositoryCollaboratorsService
	let repositoryCollaboratorsRepository: RepositoryCollaboratorsRepository
	let repositoriesService: RepositoriesService
	let repositoryPermissionsService: RepositoryPermissionsService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				RepositoryCollaboratorsService,
				{
					provide: RepositoryCollaboratorsRepository,
					useValue: {
						add: vi.fn(),
						updateRole: vi.fn(),
						remove: vi.fn(),
					},
				},
				{
					provide: RepositoriesService,
					useValue: {
						getManageableRepositoryContext: vi
							.fn()
							.mockResolvedValue(managementContext),
					},
				},
				{
					provide: RepositoryPermissionsService,
					useValue: {
						resolveImplicitRole: vi.fn().mockResolvedValue(null),
					},
				},
				{
					provide: UserService,
					useValue: {
						findUserId: vi.fn().mockResolvedValue(collaboratorUserId),
					},
				},
			],
		}).compile()

		service = moduleRef.get(RepositoryCollaboratorsService)
		repositoryCollaboratorsRepository = moduleRef.get(
			RepositoryCollaboratorsRepository
		)
		repositoriesService = moduleRef.get(RepositoriesService)
		repositoryPermissionsService = moduleRef.get(RepositoryPermissionsService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('adds a collaborator without an implicit role', async () => {
		const resolveImplicitRoleSpy = vi.spyOn(
			repositoryPermissionsService,
			'resolveImplicitRole'
		)
		vi.spyOn(repositoryCollaboratorsRepository, 'add').mockResolvedValue({
			userId: collaboratorUserId,
			role: 'write',
			createdAt: new Date('2026-07-16T00:00:00Z'),
		})

		expect(await service.add(mockUserId, addInput)).toMatchObject({
			username: 'ren',
			role: 'write',
		})
		expect(resolveImplicitRoleSpy).toHaveBeenCalledWith(collaboratorUserId, {
			ownerUserId,
			ownerOrganizationId: null,
		})
	})

	test('rejects adding the repository owner as a collaborator', async () => {
		vi.spyOn(
			repositoryPermissionsService,
			'resolveImplicitRole'
		).mockResolvedValue('owner')

		await expect(service.add(mockUserId, addInput)).rejects.toBeInstanceOf(
			RepositoryCollaboratorOwnerError
		)
		expect(repositoryCollaboratorsRepository.add).not.toHaveBeenCalled()
	})

	test('rejects adding a user with implicit organization admin access', async () => {
		vi.spyOn(
			repositoriesService,
			'getManageableRepositoryContext'
		).mockResolvedValue({
			repositoryId,
			visibility: 'private',
			ownerUserId: null,
			ownerOrganizationId,
			tesseraWritesAllowed: true,
		})
		vi.spyOn(
			repositoryPermissionsService,
			'resolveImplicitRole'
		).mockResolvedValue('admin')

		await expect(service.add(mockUserId, addInput)).rejects.toBeInstanceOf(
			RepositoryCollaboratorImplicitAccessError
		)
		expect(repositoryCollaboratorsRepository.add).not.toHaveBeenCalled()
	})

	test('reports a missing collaborator on role updates', async () => {
		vi.spyOn(repositoryCollaboratorsRepository, 'updateRole').mockResolvedValue(
			undefined
		)

		await expect(
			service.updateRole(mockUserId, addInput)
		).rejects.toBeInstanceOf(RepositoryCollaboratorNotFoundError)
	})

	test('reports a missing collaborator on removal', async () => {
		vi.spyOn(repositoryCollaboratorsRepository, 'remove').mockResolvedValue(
			false
		)

		await expect(
			service.remove(mockUserId, {
				username: addInput.username,
				slug: addInput.slug,
				collaboratorUsername: addInput.collaboratorUsername,
			})
		).rejects.toBeInstanceOf(RepositoryCollaboratorNotFoundError)
	})
})
