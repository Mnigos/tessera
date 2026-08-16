import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, asc, eq, gt, invitation, organization, user } from '@repo/db'
import type {
	OrganizationId,
	OrganizationInvitationId,
	UserId,
} from '@repo/domain'
import { OrganizationInvitationsRepository } from './organization-invitations.repository'

vi.mock('@repo/db', async importOriginal => {
	const actual = await importOriginal<typeof import('@repo/db')>()

	return {
		...actual,
		and: vi.fn(actual.and),
		asc: vi.fn(actual.asc),
		eq: vi.fn(actual.eq),
		gt: vi.fn(actual.gt),
	}
})

const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const invitationId =
	'00000000-0000-4000-8000-000000000030' as OrganizationInvitationId
const now = new Date('2026-08-16T10:00:00.000Z')
const invitationView = {
	id: invitationId,
	organizationId,
	email: 'recipient@example.com',
	role: 'member' as const,
	status: 'pending' as const,
	expiresAt: new Date('2026-08-18T10:00:00.000Z'),
	createdAt: new Date('2026-08-16T09:00:00.000Z'),
	inviter: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: 'owner',
		name: 'Owner',
	},
}
const organizationView = {
	id: organizationId,
	slug: 'tessera',
	name: 'Tessera',
	createdAt: new Date('2026-08-15T10:00:00.000Z'),
}

describe(OrganizationInvitationsRepository.name, () => {
	let moduleRef: TestingModule
	let repository: OrganizationInvitationsRepository
	const select = vi.fn()

	beforeEach(async () => {
		vi.clearAllMocks()
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationInvitationsRepository,
				{ provide: Database, useValue: { select } },
			],
		}).compile()

		repository = moduleRef.get(OrganizationInvitationsRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
	})

	test('lists pending non-expired invitations with inviter data', async () => {
		const orderBy = vi.fn().mockResolvedValue([invitationView])
		const where = vi.fn(() => ({ orderBy }))
		const innerJoin = vi.fn(() => ({ where }))
		const from = vi.fn(() => ({ innerJoin }))
		select.mockReturnValue({ from })

		expect(await repository.listPending({ organizationId, now })).toEqual([
			invitationView,
		])
		expect(from).toHaveBeenCalledWith(invitation)
		expect(innerJoin).toHaveBeenCalledWith(user, expect.anything())
		expect(eq).toHaveBeenCalledWith(invitation.organizationId, organizationId)
		expect(eq).toHaveBeenCalledWith(invitation.status, 'pending')
		expect(gt).toHaveBeenCalledWith(invitation.expiresAt, now)
		expect(and).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything()
		)
		expect(asc).toHaveBeenCalledWith(invitation.expiresAt)
		expect(asc).toHaveBeenCalledWith(invitation.id)
		expect(orderBy).toHaveBeenCalledWith(expect.anything(), expect.anything())
	})

	test('lists recipient invitations with organization data', async () => {
		const rows = [{ ...invitationView, organization: organizationView }]
		const orderBy = vi.fn().mockResolvedValue(rows)
		const where = vi.fn(() => ({ orderBy }))
		const organizationJoin = vi.fn(() => ({ where }))
		const inviterJoin = vi.fn(() => ({ innerJoin: organizationJoin }))
		const from = vi.fn(() => ({ innerJoin: inviterJoin }))
		select.mockReturnValue({ from })

		expect(
			await repository.listPendingForEmail({
				email: 'Recipient@Example.com',
				now,
			})
		).toEqual(rows)
		expect(inviterJoin).toHaveBeenCalledWith(user, expect.anything())
		expect(organizationJoin).toHaveBeenCalledWith(
			organization,
			expect.anything()
		)
		expect(eq).toHaveBeenCalledWith(invitation.email, 'recipient@example.com')
		expect(eq).toHaveBeenCalledWith(invitation.status, 'pending')
		expect(gt).toHaveBeenCalledWith(invitation.expiresAt, now)
		expect(and).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			expect.anything()
		)
		expect(orderBy).toHaveBeenCalledWith(expect.anything(), expect.anything())
	})

	test('finds one invitation with inviter and organization data', async () => {
		const row = { ...invitationView, organization: organizationView }
		const limit = vi.fn().mockResolvedValue([row])
		const where = vi.fn(() => ({ limit }))
		const organizationJoin = vi.fn(() => ({ where }))
		const inviterJoin = vi.fn(() => ({ innerJoin: organizationJoin }))
		select.mockReturnValue({
			from: vi.fn(() => ({ innerJoin: inviterJoin })),
		})

		expect(await repository.findById({ invitationId })).toEqual(row)
		expect(eq).toHaveBeenCalledWith(invitation.id, invitationId)
		expect(limit).toHaveBeenCalledWith(1)
	})

	test('returns undefined when an invitation id is missing', async () => {
		const limit = vi.fn().mockResolvedValue([])
		select.mockReturnValue({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						where: vi.fn(() => ({ limit })),
					})),
				})),
			})),
		})

		expect(await repository.findById({ invitationId })).toBeUndefined()
	})
})
