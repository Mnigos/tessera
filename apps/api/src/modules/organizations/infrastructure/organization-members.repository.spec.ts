import { Database } from '@config/database'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, asc, eq, member, user } from '@repo/db'
import type { OrganizationId, OrganizationMemberId, UserId } from '@repo/domain'
import { OrganizationMembersRepository } from './organization-members.repository'

vi.mock('@repo/db', async importOriginal => {
	const actual = await importOriginal<typeof import('@repo/db')>()

	return {
		...actual,
		and: vi.fn(actual.and),
		asc: vi.fn(actual.asc),
		eq: vi.fn(actual.eq),
	}
})

const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId
const memberId = '00000000-0000-4000-8000-000000000020' as OrganizationMemberId
const memberView = {
	id: memberId,
	role: 'member' as const,
	createdAt: new Date('2026-08-16T10:00:00.000Z'),
	user: {
		id: '00000000-0000-4000-8000-000000000001' as UserId,
		username: 'anna',
		name: 'Anna',
		image: null,
	},
}

describe(OrganizationMembersRepository.name, () => {
	let moduleRef: TestingModule
	let repository: OrganizationMembersRepository
	const select = vi.fn()

	beforeEach(async () => {
		vi.clearAllMocks()
		moduleRef = await Test.createTestingModule({
			providers: [
				OrganizationMembersRepository,
				{ provide: Database, useValue: { select } },
			],
		}).compile()

		repository = moduleRef.get(OrganizationMembersRepository)
	})

	afterEach(async () => {
		await moduleRef.close()
	})

	test('lists joined members in stable creation order', async () => {
		const orderBy = vi.fn().mockResolvedValue([memberView])
		const where = vi.fn(() => ({ orderBy }))
		const innerJoin = vi.fn(() => ({ where }))
		const from = vi.fn(() => ({ innerJoin }))
		select.mockReturnValue({ from })

		expect(await repository.listMembers({ organizationId })).toEqual([
			memberView,
		])
		expect(select).toHaveBeenCalledWith({
			id: member.id,
			role: member.role,
			createdAt: member.createdAt,
			user: {
				id: user.id,
				username: user.username,
				name: user.name,
				image: user.image,
			},
		})
		expect(from).toHaveBeenCalledWith(member)
		expect(innerJoin).toHaveBeenCalledWith(user, expect.anything())
		expect(eq).toHaveBeenCalledWith(member.organizationId, organizationId)
		expect(asc).toHaveBeenCalledWith(member.createdAt)
		expect(asc).toHaveBeenCalledWith(member.id)
		expect(orderBy).toHaveBeenCalledWith(expect.anything(), expect.anything())
	})

	test('finds a member only through the organization-scoped query', async () => {
		const limit = vi.fn().mockResolvedValue([memberView])
		const where = vi.fn(() => ({ limit }))
		const innerJoin = vi.fn(() => ({ where }))
		select.mockReturnValue({
			from: vi.fn(() => ({ innerJoin })),
		})

		expect(await repository.findMember({ organizationId, memberId })).toEqual(
			memberView
		)
		expect(innerJoin).toHaveBeenCalledWith(user, expect.anything())
		expect(eq).toHaveBeenCalledWith(member.id, memberId)
		expect(eq).toHaveBeenCalledWith(member.organizationId, organizationId)
		expect(and).toHaveBeenCalledWith(expect.anything(), expect.anything())
		expect(limit).toHaveBeenCalledWith(1)
	})

	test('returns undefined when the scoped member query is empty', async () => {
		const limit = vi.fn().mockResolvedValue([])
		select.mockReturnValue({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					where: vi.fn(() => ({ limit })),
				})),
			})),
		})

		expect(
			await repository.findMember({ organizationId, memberId })
		).toBeUndefined()
	})
})
