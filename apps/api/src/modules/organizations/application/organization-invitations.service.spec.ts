import { Test, type TestingModule } from '@nestjs/testing'
import type { Auth } from '@repo/auth'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { AuthService as BetterAuthService } from '@thallesp/nestjs-better-auth'
import { APIError } from 'better-auth/api'
import {
	OrganizationInvitationEmailMismatchError,
	OrganizationInvitationExpiredError,
	OrganizationInvitationNotFoundError,
	OrganizationInvitationPendingError,
	OrganizationMemberAlreadyExistsError,
	OrganizationNotFoundError,
	OrganizationPermissionDeniedError,
} from '../domain/organization.errors'
import type { MyOrganizationInvitationView } from '../domain/organization-invitation'
import { OrganizationInvitationsRepository } from '../infrastructure/organization-invitations.repository'
import { OrganizationsRepository } from '../infrastructure/organizations.repository'
import { OrganizationInvitationsService } from './organization-invitations.service'

const now = new Date('2026-08-16T10:00:00.000Z')
const actorUserId = '00000000-0000-4000-8000-000000000001' as UserId
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const invitationId =
	'00000000-0000-4000-8000-000000000030' as OrganizationInvitationId
const replacementInvitationId =
	'00000000-0000-4000-8000-000000000031' as OrganizationInvitationId
const actorHeaders = { cookie: 'better-auth.session_token=signed' }
const invitation: MyOrganizationInvitationView = {
	id: invitationId,
	organizationId,
	email: 'recipient@example.com',
	role: 'admin',
	status: 'pending',
	expiresAt: new Date('2026-08-18T10:00:00.000Z'),
	createdAt: new Date('2026-08-16T09:00:00.000Z'),
	inviter: {
		id: actorUserId,
		username: 'owner',
		name: 'Owner',
	},
	organization: {
		id: organizationId,
		slug: 'tessera',
		name: 'Tessera',
		createdAt: new Date('2026-08-15T10:00:00.000Z'),
	},
}

describe(OrganizationInvitationsService.name, () => {
	let moduleRef: TestingModule
	let service: OrganizationInvitationsService
	let betterAuthService: BetterAuthService<Auth>
	let organizationsRepository: OrganizationsRepository
	let invitationsRepository: OrganizationInvitationsRepository

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.useFakeTimers()
		vi.setSystemTime(now)
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationInvitationsService,
				{
					provide: BetterAuthService,
					useValue: {
						api: {
							createInvitation: vi.fn().mockResolvedValue({ id: invitationId }),
							cancelInvitation: vi.fn(),
							acceptInvitation: vi.fn(),
							rejectInvitation: vi.fn(),
						},
					},
				},
				{
					provide: OrganizationsRepository,
					useValue: {
						findMemberRole: vi.fn().mockResolvedValue('owner'),
					},
				},
				{
					provide: OrganizationInvitationsRepository,
					useValue: {
						listPending: vi.fn().mockResolvedValue([invitation]),
						listPendingForEmail: vi.fn().mockResolvedValue([invitation]),
						findById: vi.fn().mockResolvedValue(invitation),
					},
				},
			],
		}).compile()

		service = moduleRef.get(OrganizationInvitationsService)
		betterAuthService = moduleRef.get(BetterAuthService)
		organizationsRepository = moduleRef.get(OrganizationsRepository)
		invitationsRepository = moduleRef.get(OrganizationInvitationsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
		vi.useRealTimers()
	})

	test.each([
		'owner',
		'admin',
	] as const)('lists pending invitations for a %s', async role => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(role)

		expect(
			await service.listInvitations(actorUserId, { organizationId })
		).toMatchObject([{ id: invitationId, email: 'recipient@example.com' }])
		expect(invitationsRepository.listPending).toHaveBeenCalledWith({
			organizationId,
			now,
		})
	})

	test('rejects a member before reading organization invitations', async () => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(
			'member'
		)

		await expect(
			service.listInvitations(actorUserId, { organizationId })
		).rejects.toBeInstanceOf(OrganizationPermissionDeniedError)
		expect(invitationsRepository.listPending).not.toHaveBeenCalled()
	})

	test('masks invitations from a non-member', async () => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(
			undefined
		)

		await expect(
			service.listInvitations(actorUserId, { organizationId })
		).rejects.toBeInstanceOf(OrganizationNotFoundError)
	})

	test.each([
		['member', OrganizationPermissionDeniedError],
		[undefined, OrganizationNotFoundError],
	] as const)('rejects invite, resend, and cancel for role %s before reads or mutations', async (role, ErrorClass) => {
		vi.spyOn(organizationsRepository, 'findMemberRole').mockResolvedValue(role)

		await expect(
			service.invite(actorUserId, actorHeaders, {
				organizationId,
				email: invitation.email,
				role: 'member',
			})
		).rejects.toBeInstanceOf(ErrorClass)
		await expect(
			service.resendInvitation(actorUserId, actorHeaders, {
				organizationId,
				invitationId,
			})
		).rejects.toBeInstanceOf(ErrorClass)
		await expect(
			service.cancelInvitation(actorUserId, actorHeaders, {
				organizationId,
				invitationId,
			})
		).rejects.toBeInstanceOf(ErrorClass)
		expect(invitationsRepository.findById).not.toHaveBeenCalled()
		expect(betterAuthService.api.createInvitation).not.toHaveBeenCalled()
		expect(betterAuthService.api.cancelInvitation).not.toHaveBeenCalled()
	})

	test('creates an invitation with forwarded actor headers', async () => {
		const createInvitationSpy = vi.spyOn(
			betterAuthService.api,
			'createInvitation'
		)

		expect(
			await service.invite(actorUserId, actorHeaders, {
				organizationId,
				email: 'recipient@example.com',
				role: 'admin',
			})
		).toMatchObject({ id: invitationId, role: 'admin' })
		expect(createInvitationSpy).toHaveBeenCalledWith({
			body: {
				organizationId,
				email: 'recipient@example.com',
				role: 'admin',
			},
			headers: actorHeaders,
		})
	})

	test.each([
		[
			'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION',
			OrganizationMemberAlreadyExistsError,
		],
		[
			'USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION',
			OrganizationInvitationPendingError,
		],
	] as const)('maps invite error %s', async (code, ErrorClass) => {
		vi.spyOn(betterAuthService.api, 'createInvitation').mockRejectedValue(
			new APIError('BAD_REQUEST', { code, message: 'rejected' })
		)

		await expect(
			service.invite(actorUserId, actorHeaders, {
				organizationId,
				email: 'recipient@example.com',
				role: 'member',
			})
		).rejects.toBeInstanceOf(ErrorClass)
	})

	test('refreshes a live invitation without retiring it', async () => {
		vi.spyOn(invitationsRepository, 'findById')
			.mockResolvedValueOnce(invitation)
			.mockResolvedValueOnce({
				...invitation,
				expiresAt: new Date('2026-08-20T10:00:00.000Z'),
			})

		expect(
			await service.resendInvitation(actorUserId, actorHeaders, {
				organizationId,
				invitationId,
			})
		).toMatchObject({ id: invitationId })
		expect(betterAuthService.api.createInvitation).toHaveBeenCalledWith({
			body: {
				email: invitation.email,
				organizationId,
				role: 'admin',
				resend: true,
			},
			headers: actorHeaders,
		})
		expect(betterAuthService.api.cancelInvitation).not.toHaveBeenCalled()
	})

	test('retires an expired invitation before creating its replacement', async () => {
		const operations: string[] = []
		const expiredInvitation = {
			...invitation,
			role: null,
			expiresAt: new Date('2026-08-16T09:59:59.000Z'),
		}
		const replacement = {
			...invitation,
			id: replacementInvitationId,
			role: 'member' as const,
		}
		vi.spyOn(invitationsRepository, 'findById')
			.mockResolvedValueOnce(expiredInvitation)
			.mockResolvedValueOnce(replacement)
		vi.spyOn(betterAuthService.api, 'createInvitation').mockImplementation(
			() => {
				operations.push('create')
				return Promise.resolve({ id: replacementInvitationId } as never)
			}
		)
		vi.spyOn(betterAuthService.api, 'cancelInvitation').mockImplementation(
			() => {
				operations.push('cancel')
				return Promise.resolve({} as never)
			}
		)

		expect(
			await service.resendInvitation(actorUserId, actorHeaders, {
				organizationId,
				invitationId,
			})
		).toMatchObject({ id: replacementInvitationId, role: 'member' })
		expect(operations).toEqual(['cancel', 'create'])
	})

	test('a failed retirement fails the resend', async () => {
		const cancelError = new Error('cancel failed')
		vi.spyOn(invitationsRepository, 'findById').mockResolvedValue({
			...invitation,
			expiresAt: new Date('2026-08-16T09:59:59.000Z'),
		})
		vi.spyOn(betterAuthService.api, 'cancelInvitation').mockRejectedValue(
			cancelError
		)

		await expect(
			service.resendInvitation(actorUserId, actorHeaders, {
				organizationId,
				invitationId,
			})
		).rejects.toBe(cancelError)
		expect(betterAuthService.api.createInvitation).not.toHaveBeenCalled()
	})

	test.each([
		'accepted',
		'rejected',
		'canceled',
	] as const)('rejects canceling a %s invitation before Better Auth', async status => {
		vi.spyOn(invitationsRepository, 'findById').mockResolvedValue({
			...invitation,
			status,
		})

		await expect(
			service.cancelInvitation(actorUserId, actorHeaders, {
				organizationId,
				invitationId,
			})
		).rejects.toBeInstanceOf(OrganizationInvitationNotFoundError)
		expect(betterAuthService.api.cancelInvitation).not.toHaveBeenCalled()
	})

	test('lists recipient invitations using the repository expiry filter', async () => {
		expect(
			await service.listMyInvitations('Recipient@Example.com')
		).toMatchObject([{ id: invitationId, organization: { slug: 'tessera' } }])
		expect(invitationsRepository.listPendingForEmail).toHaveBeenCalledWith({
			email: 'Recipient@Example.com',
			now,
		})
	})

	test('gets an invitation for a case-insensitive matching recipient', async () => {
		expect(
			await service.getMyInvitation('Recipient@Example.com', { invitationId })
		).toMatchObject({ id: invitationId })
	})

	test('masks an invitation from a non-recipient', async () => {
		await expect(
			service.getMyInvitation('other@example.com', { invitationId })
		).rejects.toBeInstanceOf(OrganizationInvitationNotFoundError)
	})

	test('rejects getting an expired invitation', async () => {
		vi.spyOn(invitationsRepository, 'findById').mockResolvedValue({
			...invitation,
			expiresAt: now,
		})

		await expect(
			service.getMyInvitation(invitation.email, { invitationId })
		).rejects.toBeInstanceOf(OrganizationInvitationExpiredError)
	})

	test('accepts an invitation and defaults a null role to member', async () => {
		vi.spyOn(invitationsRepository, 'findById').mockResolvedValue({
			...invitation,
			role: null,
		})

		expect(
			await service.acceptInvitation(invitation.email, actorHeaders, {
				invitationId,
			})
		).toMatchObject({ id: organizationId, role: 'member' })
		expect(betterAuthService.api.acceptInvitation).toHaveBeenCalledWith({
			body: { invitationId },
			headers: actorHeaders,
		})
	})

	test('rejects accepting an expired invitation before Better Auth', async () => {
		vi.spyOn(invitationsRepository, 'findById').mockResolvedValue({
			...invitation,
			expiresAt: now,
		})

		await expect(
			service.acceptInvitation(invitation.email, actorHeaders, { invitationId })
		).rejects.toBeInstanceOf(OrganizationInvitationExpiredError)
		expect(betterAuthService.api.acceptInvitation).not.toHaveBeenCalled()
	})

	test('rejects an accepting email mismatch before Better Auth', async () => {
		await expect(
			service.acceptInvitation('other@example.com', actorHeaders, {
				invitationId,
			})
		).rejects.toBeInstanceOf(OrganizationInvitationEmailMismatchError)
		expect(betterAuthService.api.acceptInvitation).not.toHaveBeenCalled()
	})

	test('allows the matching recipient to decline an expired invitation', async () => {
		vi.spyOn(invitationsRepository, 'findById').mockResolvedValue({
			...invitation,
			expiresAt: now,
		})

		expect(
			await service.declineInvitation(invitation.email, actorHeaders, {
				invitationId,
			})
		).toBeUndefined()
		expect(betterAuthService.api.rejectInvitation).toHaveBeenCalledWith({
			body: { invitationId },
			headers: actorHeaders,
		})
	})
})
