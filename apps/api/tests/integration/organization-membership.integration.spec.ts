import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { RedisModule } from '@config/redis'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { OrganizationsModule } from '@modules/organizations'
import { GitHubLoginClient } from '@modules/organizations/infrastructure/github-login.client'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { and, eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	invitation,
	member,
	organization,
	session,
	user,
} from '@repo/db/schema'
import type {
	OrganizationId,
	OrganizationInvitationId,
	OrganizationMemberId,
	OrganizationRole,
	UserId,
} from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		RedisModule,
		RPCModule,
		AuthModule,
		OrganizationsModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class OrganizationMembershipIntegrationTestModule {}

type ActorRole = 'owner' | 'admin' | 'member'

interface IntegrationUser {
	id: UserId
	email: string
	headers: Headers
	username: string
}

interface SeededMember {
	id: OrganizationMemberId
	role: OrganizationRole
	userId: UserId
}

interface SeedInvitationOptions {
	email: string
	expiresAt?: Date
	role?: OrganizationRole
	status?: 'pending' | 'accepted' | 'rejected' | 'canceled'
}

describe('Organization membership integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let lookupLogin: ReturnType<typeof vi.fn>
	let organizationId: OrganizationId
	let owner: IntegrationUser
	let admin: IntegrationUser
	let regularMember: IntegrationUser
	let invitee: IntegrationUser
	let outsider: IntegrationUser
	let ownerMember: SeededMember
	let adminMember: SeededMember
	let regularMembership: SeededMember

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		lookupLogin = vi.fn().mockResolvedValue({ exists: false })
		moduleRef = await Test.createTestingModule({
			imports: [OrganizationMembershipIntegrationTestModule],
		})
			.overrideProvider(GitHubLoginClient)
			.useValue({ lookupLogin })
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		lookupLogin.mockReset()
		lookupLogin.mockResolvedValue({ exists: false })

		owner = await createIntegrationUser('owner')
		admin = await createIntegrationUser('admin')
		regularMember = await createIntegrationUser('member')
		invitee = await createIntegrationUser('invitee')
		outsider = await createIntegrationUser('outsider')
		organizationId = await seedOrganization('membership-org')
		ownerMember = await seedMember(organizationId, owner.id, 'owner')
		adminMember = await seedMember(organizationId, admin.id, 'admin')
		regularMembership = await seedMember(
			organizationId,
			regularMember.id,
			'member'
		)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test.each([
		['owner', 200],
		['admin', 200],
		['member', 200],
	] as const)('allows a %s to list members', async (role, expectedStatus) => {
		expect((await listMembers(actorForRole(role).headers)).status).toBe(
			expectedStatus
		)
	})

	test.each([
		['owner', 200],
		['admin', 200],
		['member', 403],
	] as const)('allows a %s to list invitations according to role', async (role, expectedStatus) => {
		await seedInvitation({ email: invitee.email })

		expect((await listInvitations(actorForRole(role).headers)).status).toBe(
			expectedStatus
		)
	})

	test.each([
		['owner', 200],
		['admin', 200],
		['member', 403],
	] as const)('allows a %s to invite according to role', async (role, expectedStatus) => {
		const email = `${role}-invite@example.com`
		const response = await inviteMember(
			email,
			'member',
			actorForRole(role).headers
		)

		expect(response.status).toBe(expectedStatus)
		if (expectedStatus === 403)
			expect(
				await db.query.invitation.findFirst({
					where: and(
						eq(invitation.organizationId, organizationId),
						eq(invitation.email, email)
					),
				})
			).toBeUndefined()
	})

	test.each([
		['owner', 200],
		['admin', 200],
		['member', 403],
	] as const)('allows a %s to cancel according to role', async (role, expectedStatus) => {
		const seededInvitation = await seedInvitation({ email: invitee.email })
		const response = await cancelInvitation(
			seededInvitation.id,
			actorForRole(role).headers
		)

		expect(response.status).toBe(expectedStatus)
		if (expectedStatus === 403)
			expect(
				await db.query.invitation.findFirst({
					where: eq(invitation.id, seededInvitation.id),
				})
			).toMatchObject({ status: 'pending' })
	})

	test.each([
		['owner', 200],
		['admin', 200],
		['member', 403],
	] as const)('allows a %s to update a member role according to role', async (role, expectedStatus) => {
		const response = await updateMemberRole(
			regularMembership.id,
			'admin',
			actorForRole(role).headers
		)

		expect(response.status).toBe(expectedStatus)
		if (expectedStatus === 403)
			expect(
				await db.query.member.findFirst({
					where: eq(member.id, regularMembership.id),
				})
			).toMatchObject({ role: 'member' })
	})

	test.each([
		['owner', 200],
		['admin', 200],
		['member', 403],
	] as const)('allows a %s to remove a member according to role', async (role, expectedStatus) => {
		const target = await seedMember(organizationId, outsider.id, 'member')
		const response = await removeMember(target.id, actorForRole(role).headers)

		expect(response.status).toBe(expectedStatus)
		if (expectedStatus === 403)
			expect(
				await db.query.member.findFirst({ where: eq(member.id, target.id) })
			).toMatchObject({ role: 'member' })
	})

	test('protects the last owner from remove, demote, and leave', async () => {
		expect((await removeMember(ownerMember.id, owner.headers)).status).toBe(409)
		expect(
			(await updateMemberRole(ownerMember.id, 'admin', owner.headers)).status
		).toBe(409)
		expect((await leaveOrganization(owner.headers)).status).toBe(409)
	})

	test('allows owner promotion by an owner and forbids it for an admin', async () => {
		expect(
			(await updateMemberRole(regularMembership.id, 'owner', admin.headers))
				.status
		).toBe(403)
		expect(
			await db.query.member.findFirst({
				where: eq(member.id, regularMembership.id),
			})
		).toMatchObject({ role: 'member' })
		expect(
			(await updateMemberRole(regularMembership.id, 'owner', owner.headers))
				.status
		).toBe(200)
		expect(
			await db.query.member.findFirst({
				where: eq(member.id, regularMembership.id),
			})
		).toMatchObject({ role: 'owner' })
	})

	test('forbids an admin from demoting or removing an owner and inviting an owner', async () => {
		expect(
			(await updateMemberRole(ownerMember.id, 'admin', admin.headers)).status
		).toBe(403)
		expect((await removeMember(ownerMember.id, admin.headers)).status).toBe(403)
		expect(
			(await inviteMember(invitee.email, 'owner', admin.headers)).status
		).toBe(403)
		expect(
			await db.query.member.findFirst({
				where: eq(member.id, ownerMember.id),
			})
		).toMatchObject({ role: 'owner' })
		expect(
			await db.query.invitation.findFirst({
				where: and(
					eq(invitation.organizationId, organizationId),
					eq(invitation.email, invitee.email)
				),
			})
		).toBeUndefined()
	})

	test.each([
		'update',
		'remove',
		'leave',
	] as const)('serializes concurrent owner %s mutations without losing the last owner', async action => {
		const secondOwner = await seedMember(organizationId, outsider.id, 'owner')
		const run = {
			update: () =>
				Promise.all([
					updateMemberRole(ownerMember.id, 'admin', owner.headers),
					updateMemberRole(secondOwner.id, 'admin', outsider.headers),
				]),
			remove: () =>
				Promise.all([
					removeMember(secondOwner.id, owner.headers),
					removeMember(ownerMember.id, outsider.headers),
				]),
			leave: () =>
				Promise.all([
					leaveOrganization(owner.headers),
					leaveOrganization(outsider.headers),
				]),
		}[action]
		const responses = await run()
		const statuses = responses.map(response => response.status).sort()
		const remainingOwners = await db
			.select({ id: member.id })
			.from(member)
			.where(
				and(eq(member.organizationId, organizationId), eq(member.role, 'owner'))
			)

		expect(statuses[0]).toBe(200)
		expect(statuses[1]).toBeGreaterThanOrEqual(400)
		expect(statuses[1]).toBeLessThan(500)
		expect(remainingOwners).toHaveLength(1)
	})

	test('rejects inviting an existing member', async () => {
		expect(
			(await inviteMember(regularMember.email, 'member', owner.headers)).status
		).toBe(409)
	})

	test('rejects a duplicate pending invitation', async () => {
		expect(
			(await inviteMember(invitee.email, 'member', owner.headers)).status
		).toBe(200)
		expect(
			(await inviteMember(invitee.email, 'member', owner.headers)).status
		).toBe(409)
	})

	test('settles concurrent invitations for one email with one conflict', async () => {
		const responses = await Promise.all([
			inviteMember(invitee.email, 'member', owner.headers),
			inviteMember(invitee.email, 'member', owner.headers),
		])
		const statuses = responses.map(response => response.status).sort()

		expect(statuses).toEqual([200, 409])
		expect(statuses).not.toContain(500)
	})

	test('normalizes invitation emails and rejects invalid addresses', async () => {
		expect(
			(
				await inviteMember(
					`  ${invitee.email.toUpperCase()}  `,
					'member',
					owner.headers
				)
			).status
		).toBe(200)
		expect(
			await db.query.invitation.findFirst({
				where: eq(invitation.organizationId, organizationId),
			})
		).toMatchObject({ email: invitee.email })
		expect(
			(await inviteMember('not-an-email', 'member', owner.headers)).status
		).toBe(400)
	})

	test('accepts a matching invitation and lists the new membership', async () => {
		const seededInvitation = await seedInvitation({ email: invitee.email })

		const acceptResponse = await acceptInvitation(
			seededInvitation.id,
			invitee.headers
		)
		expect(acceptResponse.status).toBe(200)
		expect(
			await db.query.member.findFirst({
				where: and(
					eq(member.organizationId, organizationId),
					eq(member.userId, invitee.id)
				),
			})
		).toMatchObject({ role: 'member' })

		const listResponse = await listOrganizations(invitee.headers)
		expect(listResponse.status).toBe(200)
		expect(await listResponse.json()).toMatchObject({
			organizations: [{ id: organizationId, role: 'member' }],
		})
	})

	test('rejects invitation acceptance by a mismatched email', async () => {
		const seededInvitation = await seedInvitation({ email: invitee.email })

		expect(
			(await acceptInvitation(seededInvitation.id, outsider.headers)).status
		).toBe(403)
	})

	test('hides expired invitations and rejects acceptance', async () => {
		const seededInvitation = await seedInvitation({
			email: invitee.email,
			expiresAt: new Date(Date.now() - 1000),
		})

		const listResponse = await listInvitations(owner.headers)
		expect(listResponse.status).toBe(200)
		expect(await listResponse.json()).toEqual({ invitations: [] })
		expect(
			(await acceptInvitation(seededInvitation.id, invitee.headers)).status
		).toBe(409)
	})

	test('refreshes a live invitation on resend', async () => {
		const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
		const seededInvitation = await seedInvitation({
			email: invitee.email,
			expiresAt,
		})

		const response = await resendInvitation(seededInvitation.id, owner.headers)
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			invitation: { id: seededInvitation.id },
		})
		expect(
			await db.query.invitation.findFirst({
				where: eq(invitation.id, seededInvitation.id),
			})
		).toSatisfy(
			(value: unknown) =>
				typeof value === 'object' &&
				value !== null &&
				'expiresAt' in value &&
				value.expiresAt instanceof Date &&
				value.expiresAt.getTime() > expiresAt.getTime()
		)
	})

	test('replaces an expired invitation and cancels the old row', async () => {
		const seededInvitation = await seedInvitation({
			email: invitee.email,
			expiresAt: new Date(Date.now() - 1000),
		})

		const response = await resendInvitation(seededInvitation.id, owner.headers)
		expect(response.status).toBe(200)
		const body = (await response.json()) as {
			invitation: { id: OrganizationInvitationId }
		}
		expect(body.invitation.id).not.toBe(seededInvitation.id)
		expect(
			await db.query.invitation.findFirst({
				where: eq(invitation.id, seededInvitation.id),
			})
		).toMatchObject({ status: 'canceled' })
		expect(
			await db.query.invitation.findFirst({
				where: eq(invitation.id, body.invitation.id),
			})
		).toMatchObject({ status: 'pending' })
	})

	test('rejects acceptance after cancellation', async () => {
		const seededInvitation = await seedInvitation({ email: invitee.email })

		expect(
			(await cancelInvitation(seededInvitation.id, owner.headers)).status
		).toBe(200)
		expect(
			(await acceptInvitation(seededInvitation.id, invitee.headers)).status
		).toBe(404)
	})

	test('masks invitation details from a non-recipient', async () => {
		const seededInvitation = await seedInvitation({ email: invitee.email })

		expect(
			(await getMyInvitation(seededInvitation.id, outsider.headers)).status
		).toBe(404)
	})

	test('allows an admin to leave and protects a sole owner', async () => {
		expect((await leaveOrganization(owner.headers)).status).toBe(409)
		expect((await leaveOrganization(admin.headers)).status).toBe(200)
		expect(
			await db.query.member.findFirst({
				where: eq(member.id, adminMember.id),
			})
		).toBeUndefined()
	})

	test('settles concurrent accepts with one success and no server error', async () => {
		const seededInvitation = await seedInvitation({ email: invitee.email })

		const responses = await Promise.all([
			acceptInvitation(seededInvitation.id, invitee.headers),
			acceptInvitation(seededInvitation.id, invitee.headers),
		])
		const statuses = responses.map(response => response.status).sort()

		expect(statuses[0]).toBe(200)
		expect(statuses[1]).toBeGreaterThanOrEqual(400)
		expect(statuses[1]).toBeLessThan(500)
		expect(statuses).not.toContain(500)
	})

	test('locks down raw Better Auth invitation routes', async () => {
		for (const [path, method] of [
			['invite-member', 'POST'],
			['accept-invitation', 'POST'],
			['list-invitations', 'GET'],
		] as const) {
			const response = await adapter.hono.request(
				`http://localhost/api/auth/organization/${path}`,
				{ method, headers: owner.headers }
			)

			expect(response.status).toBe(404)
		}
	})

	function actorForRole(role: ActorRole): IntegrationUser {
		return { owner, admin, member: regularMember }[role]
	}

	async function createIntegrationUser(
		username: string
	): Promise<IntegrationUser> {
		const token = crypto.randomUUID()
		const email = `${username}@example.com`
		const [createdUser] = await db
			.insert(user)
			.values({
				name: username,
				email,
				emailVerified: true,
				username,
			})
			.returning({ id: user.id })

		if (!createdUser) throw new Error('Failed to create integration user')

		await db.insert(session).values({
			token,
			userId: createdUser.id,
			expiresAt: new Date(Date.now() + 86_400_000),
		})

		const headers = new Headers()
		headers.set(
			'cookie',
			`better-auth.session_token=${token}.${await makeSignature(
				token,
				'test-auth-secret'
			)}`
		)

		return { id: createdUser.id, email, headers, username }
	}

	async function seedOrganization(slug: string): Promise<OrganizationId> {
		const [createdOrganization] = await db
			.insert(organization)
			.values({ name: 'Tessera', slug })
			.returning({ id: organization.id })

		if (!createdOrganization)
			throw new Error('Failed to create integration organization')

		return createdOrganization.id
	}

	async function seedMember(
		seedOrganizationId: OrganizationId,
		userId: UserId,
		role: OrganizationRole
	): Promise<SeededMember> {
		const [createdMember] = await db
			.insert(member)
			.values({ organizationId: seedOrganizationId, userId, role })
			.returning({ id: member.id, role: member.role, userId: member.userId })

		if (!createdMember) throw new Error('Failed to create integration member')

		return createdMember
	}

	async function seedInvitation({
		email,
		expiresAt = new Date(Date.now() + 86_400_000),
		role = 'member',
		status = 'pending',
	}: SeedInvitationOptions) {
		const [createdInvitation] = await db
			.insert(invitation)
			.values({
				email: email.toLowerCase(),
				expiresAt,
				inviterId: owner.id,
				organizationId,
				role,
				status,
			})
			.returning({ id: invitation.id, expiresAt: invitation.expiresAt })

		if (!createdInvitation)
			throw new Error('Failed to create integration invitation')

		return createdInvitation
	}

	function listOrganizations(headers: Headers) {
		return adapter.hono.request('http://localhost/organizations', { headers })
	}

	function listMembers(headers: Headers) {
		return adapter.hono.request(
			`http://localhost/organizations/${organizationId}/members`,
			{ headers }
		)
	}

	function updateMemberRole(
		memberId: OrganizationMemberId,
		role: OrganizationRole,
		headers: Headers
	) {
		return request(
			`http://localhost/organizations/${organizationId}/members/${memberId}`,
			'PATCH',
			headers,
			{ role }
		)
	}

	function removeMember(memberId: OrganizationMemberId, headers: Headers) {
		return requestWithoutBody(
			`http://localhost/organizations/${organizationId}/members/${memberId}`,
			'DELETE',
			headers
		)
	}

	function leaveOrganization(headers: Headers) {
		return requestWithoutBody(
			`http://localhost/organizations/${organizationId}/leave`,
			'POST',
			headers
		)
	}

	function listInvitations(headers: Headers) {
		return adapter.hono.request(
			`http://localhost/organizations/${organizationId}/invitations`,
			{ headers }
		)
	}

	function inviteMember(
		email: string,
		role: OrganizationRole,
		headers: Headers
	) {
		return request(
			`http://localhost/organizations/${organizationId}/invitations`,
			'POST',
			headers,
			{ email, role }
		)
	}

	function resendInvitation(
		invitationId: OrganizationInvitationId,
		headers: Headers
	) {
		return requestWithoutBody(
			`http://localhost/organizations/${organizationId}/invitations/${invitationId}/resend`,
			'POST',
			headers
		)
	}

	function cancelInvitation(
		invitationId: OrganizationInvitationId,
		headers: Headers
	) {
		return requestWithoutBody(
			`http://localhost/organizations/${organizationId}/invitations/${invitationId}`,
			'DELETE',
			headers
		)
	}

	function getMyInvitation(
		invitationId: OrganizationInvitationId,
		headers: Headers
	) {
		return adapter.hono.request(
			`http://localhost/organization-invitations/${invitationId}`,
			{ headers }
		)
	}

	function acceptInvitation(
		invitationId: OrganizationInvitationId,
		headers: Headers
	) {
		return requestWithoutBody(
			`http://localhost/organization-invitations/${invitationId}/accept`,
			'POST',
			headers
		)
	}

	function request(
		url: string,
		method: 'PATCH' | 'POST',
		headers: Headers,
		body: object
	) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request(url, {
			method,
			headers: requestHeaders,
			body: JSON.stringify(body),
		})
	}

	function requestWithoutBody(
		url: string,
		method: 'DELETE' | 'POST',
		headers: Headers
	) {
		return adapter.hono.request(url, { method, headers })
	}

	async function resetIntegrationDatabase() {
		await db.delete(invitation)
		await db.delete(member)
		await db.delete(organization)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})
