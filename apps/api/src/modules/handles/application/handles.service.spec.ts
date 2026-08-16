import { OrganizationsRepository } from '@modules/organizations'
import { RepositoriesRepository } from '@modules/repositories/infrastructure/repositories.repository'
import { UserService } from '@modules/user'
import { Test, type TestingModule } from '@nestjs/testing'
import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { HandleNotFoundError } from '../domain/handle.errors'
import { HandlesService } from './handles.service'

const profileUserId = '00000000-0000-4000-8000-000000000001' as UserId
const viewerUserId = '00000000-0000-4000-8000-000000000002' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const createdAt = new Date('2026-08-16T10:00:00.000Z')
const repository = {
	id: '00000000-0000-4000-8000-000000000020' as RepositoryId,
	name: 'Notes' as RepositoryName,
	slug: 'notes' as RepositorySlug,
	visibility: 'public' as const,
}
const publicUser = {
	id: profileUserId,
	username: 'alice',
	displayName: 'Alice',
}
const organization = {
	id: organizationId,
	slug: 'acme',
	name: 'Acme',
	createdAt,
}

describe(HandlesService.name, () => {
	let moduleRef: TestingModule
	let service: HandlesService
	let organizationsRepository: OrganizationsRepository
	let repositoriesRepository: RepositoriesRepository
	let userService: UserService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				HandlesService,
				{
					provide: OrganizationsRepository,
					useValue: {
						findBySlug: vi.fn(),
						findMemberRole: vi.fn(),
					},
				},
				{
					provide: RepositoriesRepository,
					useValue: { listVisibleByOwner: vi.fn() },
				},
				{
					provide: UserService,
					useValue: { findPublicUser: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(HandlesService)
		organizationsRepository = moduleRef.get(OrganizationsRepository)
		repositoriesRepository = moduleRef.get(RepositoriesRepository)
		userService = moduleRef.get(UserService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('prefers the user and derives self role when both namespaces match', async () => {
		vi.spyOn(userService, 'findPublicUser').mockResolvedValue(publicUser)
		vi.spyOn(organizationsRepository, 'findBySlug').mockResolvedValue(
			organization
		)
		vi.spyOn(repositoriesRepository, 'listVisibleByOwner').mockResolvedValue([
			repository,
		])

		expect(await service.get(profileUserId, { handle: 'alice' })).toEqual({
			owner: { kind: 'user', user: publicUser, viewerRole: 'self' },
			repositories: [repository],
		})
		expect(repositoriesRepository.listVisibleByOwner).toHaveBeenCalledWith({
			ownerUserId: profileUserId,
			viewerUserId: profileUserId,
		})
		expect(organizationsRepository.findMemberRole).not.toHaveBeenCalled()
	})

	test('omits self role for another user viewer', async () => {
		vi.spyOn(userService, 'findPublicUser').mockResolvedValue(publicUser)
		vi.spyOn(organizationsRepository, 'findBySlug').mockResolvedValue(undefined)
		vi.spyOn(repositoriesRepository, 'listVisibleByOwner').mockResolvedValue([])

		expect(await service.get(viewerUserId, { handle: 'alice' })).toEqual({
			owner: { kind: 'user', user: publicUser, viewerRole: undefined },
			repositories: [],
		})
	})

	test('derives organization viewer role and visible repositories', async () => {
		vi.spyOn(userService, 'findPublicUser').mockResolvedValue(undefined)
		vi.spyOn(organizationsRepository, 'findBySlug').mockResolvedValue(
			organization
		)
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(
			'admin'
		)
		vi.spyOn(repositoriesRepository, 'listVisibleByOwner').mockResolvedValue([
			repository,
		])

		expect(await service.get(viewerUserId, { handle: 'acme' })).toEqual({
			owner: {
				kind: 'organization',
				organization,
				viewerRole: 'admin',
			},
			repositories: [repository],
		})
		expect(organizationsRepository.findMemberRole).toHaveBeenCalledWith({
			organizationId,
			userId: viewerUserId,
		})
		expect(repositoriesRepository.listVisibleByOwner).toHaveBeenCalledWith({
			ownerOrganizationId: organizationId,
			viewerUserId,
		})
	})

	test('omits organization viewer role and membership lookup for anonymous viewers', async () => {
		vi.spyOn(userService, 'findPublicUser').mockResolvedValue(undefined)
		vi.spyOn(organizationsRepository, 'findBySlug').mockResolvedValue(
			organization
		)
		vi.spyOn(repositoriesRepository, 'listVisibleByOwner').mockResolvedValue([])

		expect(await service.get(undefined, { handle: 'acme' })).toEqual({
			owner: {
				kind: 'organization',
				organization,
				viewerRole: undefined,
			},
			repositories: [],
		})
		expect(organizationsRepository.findMemberRole).not.toHaveBeenCalled()
	})

	test('throws a handle-specific 404 when neither namespace matches', async () => {
		vi.spyOn(userService, 'findPublicUser').mockResolvedValue(undefined)
		vi.spyOn(organizationsRepository, 'findBySlug').mockResolvedValue(undefined)

		await expect(
			service.get(viewerUserId, { handle: 'missing' })
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof HandleNotFoundError &&
				error.code === 'NOT_FOUND' &&
				error.message === 'Handle not found' &&
				error.context?.handle === 'missing' &&
				error.context?.resource === 'handle'
		)
		expect(repositoriesRepository.listVisibleByOwner).not.toHaveBeenCalled()
	})
})
