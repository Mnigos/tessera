import { Test, type TestingModule } from '@nestjs/testing'
import type { OrganizationId, RepositoryId, UserId } from '@repo/domain'
import { RepositoriesRepository } from '../infrastructure/repositories.repository'
import {
	RepositoryPermissionsService,
	type RepositoryRoleTarget,
} from './repository-permissions.service'

const repositoryId = '00000000-0000-4000-8000-000000000001' as RepositoryId
const ownerUserId = '00000000-0000-4000-8000-000000000002' as UserId
const viewerUserId = '00000000-0000-4000-8000-000000000003' as UserId
const ownerOrganizationId =
	'00000000-0000-4000-8000-000000000004' as OrganizationId

const userOwnedRepository: RepositoryRoleTarget = {
	id: repositoryId,
	visibility: 'private',
	ownerUserId,
	ownerOrganizationId: null,
}

const organizationOwnedRepository: RepositoryRoleTarget = {
	id: repositoryId,
	visibility: 'private',
	ownerUserId: null,
	ownerOrganizationId,
}

describe(RepositoryPermissionsService.name, () => {
	let moduleRef: TestingModule
	let repositoryPermissionsService: RepositoryPermissionsService
	let repositoriesRepository: RepositoriesRepository

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				RepositoryPermissionsService,
				{
					provide: RepositoriesRepository,
					useValue: {
						findCollaboratorRole: vi.fn(),
						findOrganizationMemberRole: vi.fn(),
					},
				},
			],
		}).compile()

		repositoryPermissionsService = moduleRef.get(RepositoryPermissionsService)
		repositoriesRepository = moduleRef.get(RepositoriesRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('resolves the user owner without looking up a collaborator role', async () => {
		expect(
			await repositoryPermissionsService.resolveRole(
				ownerUserId,
				userOwnedRepository
			)
		).toBe('owner')
		expect(repositoriesRepository.findCollaboratorRole).not.toHaveBeenCalled()
	})

	test('denies another user without a collaborator role on a private user-owned repository', async () => {
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			undefined
		)

		expect(
			await repositoryPermissionsService.resolveRole(
				viewerUserId,
				userOwnedRepository
			)
		).toBeNull()
	})

	test('grants read access to another user without a collaborator role on a public user-owned repository', async () => {
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			undefined
		)

		expect(
			await repositoryPermissionsService.resolveRole(viewerUserId, {
				...userOwnedRepository,
				visibility: 'public',
			})
		).toBe('read')
	})

	test('grants unauthenticated read access to a public user-owned repository without looking up a collaborator role', async () => {
		expect(
			await repositoryPermissionsService.resolveRole(null, {
				...userOwnedRepository,
				visibility: 'public',
			})
		).toBe('read')
		expect(repositoriesRepository.findCollaboratorRole).not.toHaveBeenCalled()
	})

	test('denies unauthenticated access to a private user-owned repository', async () => {
		expect(
			await repositoryPermissionsService.resolveRole(null, userOwnedRepository)
		).toBeNull()
	})

	test.each([
		'read',
		'write',
		'admin',
	] as const)('resolves a private user-owned repository collaborator with the %s role', async role => {
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			role
		)

		expect(
			await repositoryPermissionsService.resolveRole(
				viewerUserId,
				userOwnedRepository
			)
		).toBe(role)
	})

	test('does not look up organization membership for user-owned repositories', async () => {
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			undefined
		)

		await repositoryPermissionsService.resolveRole(
			viewerUserId,
			userOwnedRepository
		)

		expect(
			repositoriesRepository.findOrganizationMemberRole
		).not.toHaveBeenCalled()
	})

	test.each([
		'owner',
		'admin',
	] as const)('maps the organization %s role to repository admin', async role => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(role)

		expect(
			await repositoryPermissionsService.resolveRole(
				viewerUserId,
				organizationOwnedRepository
			)
		).toBe('admin')
	})

	test('denies an organization member without a collaborator role on a private repository', async () => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue('member')
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			undefined
		)

		expect(
			await repositoryPermissionsService.resolveRole(
				viewerUserId,
				organizationOwnedRepository
			)
		).toBeNull()
	})

	test('resolves an organization member collaborator with the write role', async () => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue('member')
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			'write'
		)

		expect(
			await repositoryPermissionsService.resolveRole(
				viewerUserId,
				organizationOwnedRepository
			)
		).toBe('write')
	})

	test('denies a non-member without a collaborator role on a private organization repository', async () => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(undefined)
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			undefined
		)

		expect(
			await repositoryPermissionsService.resolveRole(
				viewerUserId,
				organizationOwnedRepository
			)
		).toBeNull()
	})

	test('grants a non-member read access to a public organization repository', async () => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(undefined)
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			undefined
		)

		expect(
			await repositoryPermissionsService.resolveRole(viewerUserId, {
				...organizationOwnedRepository,
				visibility: 'public',
			})
		).toBe('read')
	})

	test('resolves the implicit owner role for the repository owner', async () => {
		expect(
			await repositoryPermissionsService.resolveImplicitRole(
				ownerUserId,
				userOwnedRepository
			)
		).toBe('owner')
	})

	test.each([
		'owner',
		'admin',
	] as const)('resolves the implicit admin role for an organization %s', async role => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue(role)

		expect(
			await repositoryPermissionsService.resolveImplicitRole(
				viewerUserId,
				organizationOwnedRepository
			)
		).toBe('admin')
	})

	test('resolves no implicit role for an organization member', async () => {
		vi.spyOn(
			repositoriesRepository,
			'findOrganizationMemberRole'
		).mockResolvedValue('member')

		expect(
			await repositoryPermissionsService.resolveImplicitRole(
				viewerUserId,
				organizationOwnedRepository
			)
		).toBeNull()
	})

	test('ignores collaborator roles and public visibility when resolving implicit roles', async () => {
		vi.spyOn(repositoriesRepository, 'findCollaboratorRole').mockResolvedValue(
			'admin'
		)

		expect(
			await repositoryPermissionsService.resolveImplicitRole(viewerUserId, {
				...userOwnedRepository,
				visibility: 'public',
			})
		).toBeNull()
		expect(repositoriesRepository.findCollaboratorRole).not.toHaveBeenCalled()
	})

	test('resolves no implicit role for anonymous viewers', async () => {
		expect(
			await repositoryPermissionsService.resolveImplicitRole(
				null,
				userOwnedRepository
			)
		).toBeNull()
	})
})
