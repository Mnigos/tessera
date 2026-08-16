import { Test, type TestingModule } from '@nestjs/testing'
import type { Auth } from '@repo/auth'
import type { OrganizationId, UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { APIError } from 'better-auth/api'
import {
	OrganizationCreateFailedError,
	OrganizationDeleteConfirmationError,
	OrganizationHasRepositoriesError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
	OrganizationSlugTakenError,
} from '../domain/organization.errors'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { OrganizationHandlePolicyService } from './organization-handle-policy.service'
import { OrganizationsService } from './organizations.service'

const actorUserId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const createdAt = new Date('2026-08-16T10:00:00.000Z')
const organization = {
	id: organizationId,
	slug: 'tessera',
	name: 'Tessera',
	createdAt,
}
const deleteInput = { organizationId, confirmationSlug: 'tessera' }

describe(OrganizationsService.name, () => {
	let moduleRef: TestingModule
	let service: OrganizationsService
	let betterAuthService: BetterAuthService<Auth>
	let repository: OrganizationsRepository
	let handlePolicy: OrganizationHandlePolicyService

	beforeEach(async () => {
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationsService,
				{
					provide: BetterAuthService,
					useValue: {
						api: {
							createOrganization: vi.fn(),
							updateOrganization: vi.fn(),
						},
					},
				},
				{
					provide: OrganizationsRepository,
					useValue: {
						listMemberships: vi.fn(),
						findById: vi.fn().mockResolvedValue(organization),
						findMemberRole: vi.fn().mockResolvedValue('owner'),
						deleteOwned: vi.fn().mockResolvedValue({ kind: 'deleted' }),
					},
				},
				{
					provide: OrganizationHandlePolicyService,
					useValue: { assertAvailable: vi.fn() },
				},
			],
		}).compile()

		service = moduleRef.get(OrganizationsService)
		betterAuthService = moduleRef.get(BetterAuthService)
		repository = moduleRef.get(OrganizationsRepository)
		handlePolicy = moduleRef.get(OrganizationHandlePolicyService)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.clearAllMocks()
	})

	test('lists the memberships the repository returns', async () => {
		vi.spyOn(repository, 'listMemberships').mockResolvedValue([
			{ ...organization, role: 'owner' },
		])

		expect(await service.list(actorUserId)).toEqual([
			{
				id: organizationId,
				slug: 'tessera',
				name: 'Tessera',
				createdAt,
				role: 'owner',
			},
		])
	})

	test('creates an organization after the handle policy passes', async () => {
		const createOrganizationSpy = vi
			.spyOn(betterAuthService.api, 'createOrganization')
			.mockResolvedValue(organization as never)

		expect(
			await service.create(actorUserId, {
				name: 'Tessera',
				slug: 'tessera',
			})
		).toMatchObject({ id: organizationId, slug: 'tessera' })
		expect(handlePolicy.assertAvailable).toHaveBeenCalledWith({
			slug: 'tessera',
			actorUserId,
		})
		expect(createOrganizationSpy).toHaveBeenCalledWith({
			body: {
				name: 'Tessera',
				slug: 'tessera',
				userId: actorUserId,
				keepCurrentActiveOrganization: true,
			},
		})
	})

	test('does not call Better Auth when the handle policy rejects creation', async () => {
		vi.spyOn(handlePolicy, 'assertAvailable').mockRejectedValue(
			new OrganizationSlugTakenError()
		)

		await expect(
			service.create(actorUserId, { name: 'Tessera', slug: 'tessera' })
		).rejects.toBeInstanceOf(OrganizationSlugTakenError)
		expect(betterAuthService.api.createOrganization).not.toHaveBeenCalled()
	})

	test('reports an empty Better Auth create response', async () => {
		vi.spyOn(betterAuthService.api, 'createOrganization').mockResolvedValue(
			null as never
		)

		await expect(
			service.create(actorUserId, { name: 'Tessera', slug: 'tessera' })
		).rejects.toBeInstanceOf(OrganizationCreateFailedError)
	})

	test('maps a raced Better Auth slug conflict', async () => {
		vi.spyOn(betterAuthService.api, 'createOrganization').mockRejectedValue(
			new APIError('BAD_REQUEST', {
				code: 'ORGANIZATION_ALREADY_EXISTS',
				message: 'exists',
			})
		)

		await expect(
			service.create(actorUserId, { name: 'Tessera', slug: 'tessera' })
		).rejects.toBeInstanceOf(OrganizationSlugTakenError)
	})

	test('gets an organization for a member without leaking it to outsiders', async () => {
		expect(await service.get(actorUserId, { organizationId })).toMatchObject({
			organization: { id: organizationId },
			viewerRole: 'owner',
		})

		vi.spyOn(repository, 'findMemberRole').mockResolvedValue(undefined)

		await expect(
			service.get(actorUserId, { organizationId })
		).rejects.toBeInstanceOf(OrganizationNotFoundError)
	})

	test('returns an unchanged organization without invoking policy or Better Auth', async () => {
		expect(
			await service.update(
				actorUserId,
				{ cookie: 'signed' },
				{
					organizationId,
					name: 'Tessera',
					slug: 'tessera',
				}
			)
		).toMatchObject({ id: organizationId, slug: 'tessera' })
		expect(handlePolicy.assertAvailable).not.toHaveBeenCalled()
		expect(betterAuthService.api.updateOrganization).not.toHaveBeenCalled()
	})

	test('re-runs the handle guard on rename and forwards actor headers', async () => {
		const updated = { ...organization, slug: 'tessera-next' }
		const updateOrganizationSpy = vi
			.spyOn(betterAuthService.api, 'updateOrganization')
			.mockResolvedValue(updated as never)
		const actorHeaders = { cookie: 'better-auth.session_token=signed' }

		expect(
			await service.update(actorUserId, actorHeaders, {
				organizationId,
				slug: 'tessera-next',
			})
		).toMatchObject({ slug: 'tessera-next' })
		expect(handlePolicy.assertAvailable).toHaveBeenCalledWith({
			slug: 'tessera-next',
			actorUserId,
			ignoreOrganizationId: organizationId,
		})
		expect(updateOrganizationSpy).toHaveBeenCalledWith({
			body: {
				organizationId,
				data: { name: undefined, slug: 'tessera-next' },
			},
			headers: actorHeaders,
		})
	})

	test('refuses a member before spending a handle lookup', async () => {
		vi.spyOn(repository, 'findMemberRole').mockResolvedValue('member')

		await expect(
			service.update(
				actorUserId,
				{},
				{
					organizationId,
					slug: 'tessera-next',
				}
			)
		).rejects.toBeInstanceOf(OrganizationPermissionDeniedError)
		expect(handlePolicy.assertAvailable).not.toHaveBeenCalled()
		expect(betterAuthService.api.updateOrganization).not.toHaveBeenCalled()
	})

	test('maps Better Auth update permission errors', async () => {
		vi.spyOn(betterAuthService.api, 'updateOrganization').mockRejectedValue(
			new APIError('FORBIDDEN', {
				code: 'YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_ORGANIZATION',
				message: 'forbidden',
			})
		)

		await expect(
			service.update(
				actorUserId,
				{},
				{
					organizationId,
					name: 'Next name',
				}
			)
		).rejects.toBeInstanceOf(OrganizationPermissionDeniedError)
	})

	test('delegates all deletion checks to the transactional repository', async () => {
		const deleteOwnedSpy = vi.spyOn(repository, 'deleteOwned')

		expect(await service.delete(actorUserId, deleteInput)).toBeUndefined()
		expect(deleteOwnedSpy).toHaveBeenCalledWith({
			organizationId,
			userId: actorUserId,
			confirmationSlug: 'tessera',
		})
	})

	test('maps a missing organization or membership on delete to not found', async () => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({ kind: 'not-found' })

		await expect(
			service.delete(actorUserId, deleteInput)
		).rejects.toBeInstanceOf(OrganizationNotFoundError)
	})

	test.each([
		'admin',
		'member',
	] as const)('refuses deletion by a %s', async role => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({
			kind: 'forbidden',
			actorRole: role,
		})

		await expect(
			service.delete(actorUserId, deleteInput)
		).rejects.toBeInstanceOf(OrganizationPermissionDeniedError)
	})

	test('maps a confirmation mismatch to a bad request', async () => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({
			kind: 'confirmation-mismatch',
		})

		await expect(
			service.delete(actorUserId, deleteInput)
		).rejects.toBeInstanceOf(OrganizationDeleteConfirmationError)
	})

	test('reports the repository count when deletion is blocked', async () => {
		vi.spyOn(repository, 'deleteOwned').mockResolvedValue({
			kind: 'has-repositories',
			repositoryCount: 2,
		})

		await expect(service.delete(actorUserId, deleteInput)).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof OrganizationHasRepositoriesError &&
				error.context?.repositoryCount === 2
		)
	})
})
