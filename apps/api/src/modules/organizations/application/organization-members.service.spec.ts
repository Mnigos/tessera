import { Test, type TestingModule } from '@nestjs/testing'
import type { Auth } from '@repo/auth'
import type { OrganizationId, OrganizationMemberId, UserId } from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { APIError } from 'better-auth/api'
import {
	OrganizationLastOwnerError,
	OrganizationMemberNotFoundError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import { OrganizationMembersRepository } from '../infrastructure/organization-members.repository'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { OrganizationMembersService } from './organization-members.service'

const actorUserId = '00000000-0000-4000-8000-000000000001' as UserId
const memberUserId = '00000000-0000-4000-8000-000000000002' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const memberId = '00000000-0000-4000-8000-000000000020' as OrganizationMemberId
const actorHeaders = { cookie: 'better-auth.session_token=signed' }
const createdAt = new Date('2026-08-16T10:00:00.000Z')
const memberView = {
	id: memberId,
	role: 'member' as const,
	createdAt,
	user: {
		id: memberUserId,
		username: 'anna',
		name: 'Anna',
		image: null,
	},
}

describe(OrganizationMembersService.name, () => {
	let moduleRef: TestingModule
	let service: OrganizationMembersService
	let betterAuthService: BetterAuthService<Auth>
	let organizationsRepository: OrganizationsRepository
	let membersRepository: OrganizationMembersRepository

	beforeEach(async () => {
		vi.clearAllMocks()
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationMembersService,
				{
					provide: BetterAuthService,
					useValue: {
						api: {
							updateMemberRole: vi.fn(),
							removeMember: vi.fn(),
							leaveOrganization: vi.fn(),
						},
					},
				},
				{
					provide: OrganizationsRepository,
					useValue: {
						findMemberRole: vi.fn().mockResolvedValue('owner'),
						withOrganizationLock: vi.fn(
							(_organizationId, run: () => Promise<unknown>) => run()
						),
					},
				},
				{
					provide: OrganizationMembersRepository,
					useValue: {
						listMembers: vi.fn().mockResolvedValue([memberView]),
						findMember: vi.fn().mockResolvedValue(memberView),
					},
				},
			],
		}).compile()

		service = moduleRef.get(OrganizationMembersService)
		betterAuthService = moduleRef.get(BetterAuthService)
		organizationsRepository = moduleRef.get(OrganizationsRepository)
		membersRepository = moduleRef.get(OrganizationMembersRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
	})

	test('lists mapped members for a member viewer', async () => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(
			'member'
		)

		expect(await service.listMembers(actorUserId, { organizationId })).toEqual({
			members: [
				{
					id: memberId,
					role: 'member',
					createdAt,
					user: {
						id: memberUserId,
						username: 'anna',
						displayName: 'Anna',
						avatarUrl: undefined,
					},
				},
			],
			viewerRole: 'member',
		})
		expect(membersRepository.listMembers).toHaveBeenCalledWith({
			organizationId,
		})
	})

	test('masks the member list from a non-member', async () => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(
			undefined
		)

		await expect(
			service.listMembers(actorUserId, { organizationId })
		).rejects.toBeInstanceOf(OrganizationNotFoundError)
		expect(membersRepository.listMembers).not.toHaveBeenCalled()
	})

	test('updates a member role inside the organization lock', async () => {
		const updateMemberRoleSpy = vi
			.spyOn(betterAuthService.api, 'updateMemberRole')
			.mockResolvedValue({} as never)

		expect(
			await service.updateMemberRole(actorUserId, actorHeaders, {
				organizationId,
				memberId,
				role: 'admin',
			})
		).toMatchObject({ id: memberId, role: 'admin' })
		expect(organizationsRepository.withOrganizationLock).toHaveBeenCalledWith(
			organizationId,
			expect.any(Function)
		)
		expect(updateMemberRoleSpy).toHaveBeenCalledWith({
			body: { organizationId, memberId, role: 'admin' },
			headers: actorHeaders,
		})
	})

	test('rejects an unknown member before Better Auth', async () => {
		vi.spyOn(membersRepository, 'findMember').mockResolvedValue(undefined)

		await expect(
			service.updateMemberRole(actorUserId, actorHeaders, {
				organizationId,
				memberId,
				role: 'admin',
			})
		).rejects.toBeInstanceOf(OrganizationMemberNotFoundError)
		expect(betterAuthService.api.updateMemberRole).not.toHaveBeenCalled()
	})

	test('maps a last-owner role update refusal', async () => {
		vi.spyOn(betterAuthService.api, 'updateMemberRole').mockRejectedValue(
			new APIError('BAD_REQUEST', {
				code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER',
				message: 'rejected',
			})
		)

		await expect(
			service.updateMemberRole(actorUserId, actorHeaders, {
				organizationId,
				memberId,
				role: 'member',
			})
		).rejects.toSatisfy(
			(error: unknown) =>
				error instanceof OrganizationLastOwnerError &&
				error.context?.organizationId === organizationId &&
				error.context?.memberId === memberId &&
				error.context?.role === 'member'
		)
	})

	test('removes a non-owner inside the organization lock', async () => {
		const removeMemberSpy = vi
			.spyOn(betterAuthService.api, 'removeMember')
			.mockResolvedValue({} as never)

		expect(
			await service.removeMember(actorUserId, actorHeaders, {
				organizationId,
				memberId,
			})
		).toBeUndefined()
		expect(organizationsRepository.withOrganizationLock).toHaveBeenCalledWith(
			organizationId,
			expect.any(Function)
		)
		expect(removeMemberSpy).toHaveBeenCalledWith({
			body: { organizationId, memberIdOrEmail: memberId },
			headers: actorHeaders,
		})
	})

	test('rejects an admin removing an owner before Better Auth', async () => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(
			'admin'
		)
		vi.spyOn(membersRepository, 'findMember').mockResolvedValue({
			...memberView,
			role: 'owner',
		})

		await expect(
			service.removeMember(actorUserId, actorHeaders, {
				organizationId,
				memberId,
			})
		).rejects.toBeInstanceOf(OrganizationPermissionDeniedError)
		expect(betterAuthService.api.removeMember).not.toHaveBeenCalled()
	})

	test('maps a last-owner removal refusal', async () => {
		vi.spyOn(membersRepository, 'findMember').mockResolvedValue({
			...memberView,
			role: 'owner',
		})
		vi.spyOn(betterAuthService.api, 'removeMember').mockRejectedValue(
			new APIError('BAD_REQUEST', {
				code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
				message: 'rejected',
			})
		)

		await expect(
			service.removeMember(actorUserId, actorHeaders, {
				organizationId,
				memberId,
			})
		).rejects.toBeInstanceOf(OrganizationLastOwnerError)
	})

	test('leaves inside the organization lock with forwarded headers', async () => {
		const leaveOrganizationSpy = vi
			.spyOn(betterAuthService.api, 'leaveOrganization')
			.mockResolvedValue({} as never)

		expect(
			await service.leave(actorUserId, actorHeaders, { organizationId })
		).toBeUndefined()
		expect(organizationsRepository.withOrganizationLock).toHaveBeenCalledWith(
			organizationId,
			expect.any(Function)
		)
		expect(leaveOrganizationSpy).toHaveBeenCalledWith({
			body: { organizationId },
			headers: actorHeaders,
		})
	})

	test('maps a last-owner leave refusal', async () => {
		vi.spyOn(betterAuthService.api, 'leaveOrganization').mockRejectedValue(
			new APIError('BAD_REQUEST', {
				code: 'YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER',
				message: 'rejected',
			})
		)

		await expect(
			service.leave(actorUserId, actorHeaders, { organizationId })
		).rejects.toBeInstanceOf(OrganizationLastOwnerError)
	})
})
