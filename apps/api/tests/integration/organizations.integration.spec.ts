import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { CacheRedisClient, RedisModule } from '@config/redis'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { OrganizationsModule } from '@modules/organizations'
import { GitHubLookupUnavailableError } from '@modules/organizations/domain/organization.errors'
import { GitHubLoginClient } from '@modules/organizations/infrastructure/github-login.client'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { count, eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	invitation,
	member,
	organization,
	repositories,
	session,
	user,
} from '@repo/db/schema'
import type {
	OrganizationId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const GITHUB_CACHE_HANDLES = [
	'tessera',
	'shared-handle',
	'old-login',
	'tesseraclaimed',
	'github-free',
	'github-unavailable',
	'concurrent',
	'private-org',
	'validation-org',
	'before-rename',
	'blocked-rename',
	'role-rename',
	'admin-renamed',
	'repo-owner',
	'delete-empty',
	'keep-org',
	'admin-delete',
	'confirm-delete',
]
const GITHUB_CACHE_KEYS = GITHUB_CACHE_HANDLES.flatMap(handle => [
	`github:login-exists:v1:${handle}`,
	`github:login-exists-lock:v1:${handle}`,
])

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
class OrganizationsIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface OrganizationResponse {
	organization: {
		id: OrganizationId
		slug: string
		name: string
	}
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
}

describe('Organizations integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let cacheRedis: CacheRedisClient
	let lookupLogin: ReturnType<typeof vi.fn>
	let owner: IntegrationUser
	let admin: IntegrationUser
	let regularMember: IntegrationUser
	let outsider: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		lookupLogin = vi.fn()
		moduleRef = await Test.createTestingModule({
			imports: [OrganizationsIntegrationTestModule],
		})
			.overrideProvider(GitHubLoginClient)
			.useValue({ lookupLogin })
			.compile()

		cacheRedis = moduleRef.get(CacheRedisClient)
		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		await clearOrganizationCache()
		lookupLogin.mockReset()
		lookupLogin.mockResolvedValue({ exists: false })

		owner = await createIntegrationUser('owner')
		admin = await createIntegrationUser('admin')
		regularMember = await createIntegrationUser('member')
		outsider = await createIntegrationUser('outsider')
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await clearOrganizationCache()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('locks down every raw Better Auth organization route Tessera owns', async () => {
		for (const [path, method] of [
			['create', 'POST'],
			['update', 'POST'],
			['delete', 'POST'],
			['leave', 'POST'],
			['invite-member', 'POST'],
			['remove-member', 'POST'],
			['update-member-role', 'POST'],
			['set-active', 'POST'],
			['accept-invitation', 'POST'],
			['reject-invitation', 'POST'],
			['cancel-invitation', 'POST'],
			['list-invitations', 'GET'],
			['get-full-organization', 'GET'],
		] as const) {
			const response = await adapter.hono.request(
				`http://localhost/api/auth/organization/${path}`,
				{ method, headers: owner.headers }
			)

			expect(response.status).toBe(404)
		}
	})

	test('requires authentication for every organization lifecycle route', async () => {
		const created = await createOrganizationBody('private-org', owner.headers)
		const unauthenticatedHeaders = new Headers()
		const responses = await Promise.all([
			listOrganizations(unauthenticatedHeaders),
			createOrganization('unauth-create', unauthenticatedHeaders),
			getOrganization(created.organization.id, unauthenticatedHeaders),
			updateOrganization(
				created.organization.id,
				{ name: 'Nope' },
				unauthenticatedHeaders
			),
			deleteOrganization(
				created.organization.id,
				created.organization.slug,
				unauthenticatedHeaders
			),
		])

		expect(responses.map(response => response.status)).toEqual([
			401, 401, 401, 401, 401,
		])
	})

	test.each([
		['malformed slug', { name: 'Tessera', slug: 'invalid_slug' }],
		['overlong slug', { name: 'Tessera', slug: 'a'.repeat(40) }],
		['blank name', { name: ' ', slug: 'blank-name' }],
		['overlong name', { name: 'a'.repeat(101), slug: 'long-name' }],
	])('rejects a %s at the API boundary', async (_label, body) => {
		const response = await request(
			'http://localhost/organizations',
			'POST',
			owner.headers,
			body
		)

		expect(response.status).toBe(400)
		expect(lookupLogin).not.toHaveBeenCalled()
	})

	test.each([
		['malformed slug', { slug: 'invalid_slug' }],
		['overlong slug', { slug: 'a'.repeat(40) }],
		['blank name', { name: ' ' }],
		['overlong name', { name: 'a'.repeat(101) }],
	])('rejects a %s on update without changing the organization', async (_label, body) => {
		const created = await createOrganizationBody(
			'validation-org',
			owner.headers
		)
		lookupLogin.mockClear()

		const response = await updateOrganization(
			created.organization.id,
			body,
			owner.headers
		)

		expect(response.status).toBe(400)
		expect(lookupLogin).not.toHaveBeenCalled()
		expect(
			await db.query.organization.findFirst({
				where: eq(organization.id, created.organization.id),
			})
		).toMatchObject({ name: 'Tessera', slug: 'validation-org' })
	})

	test('creates an organization with the creator as owner and lists the membership', async () => {
		const createResponse = await createOrganization('tessera', owner.headers)
		expect(createResponse.status).toBe(200)
		const { organization: created } =
			(await createResponse.json()) as OrganizationResponse

		expect(
			await db.query.member.findFirst({
				where: eq(member.organizationId, created.id),
			})
		).toMatchObject({ userId: owner.id, role: 'owner' })

		const listResponse = await listOrganizations(owner.headers)
		expect(listResponse.status).toBe(200)
		expect(await listResponse.json()).toMatchObject({
			organizations: [
				{ id: created.id, slug: 'tessera', name: 'Tessera', role: 'owner' },
			],
		})
	})

	test('rejects an organization slug held by a username', async () => {
		const response = await createOrganization(owner.username, outsider.headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body.message).toBe(
			'This handle is already taken by a user or organization.'
		)
	})

	test('rejects a slug held by another organization', async () => {
		expect(
			(await createOrganization('shared-handle', owner.headers)).status
		).toBe(200)

		const response = await createOrganization('shared-handle', outsider.headers)
		expect(response.status).toBe(409)
		expect(await response.json()).toMatchObject({ code: 'CONFLICT' })
	})

	test('rejects an existing unclaimed GitHub login and names it', async () => {
		lookupLogin.mockResolvedValue({
			exists: true,
			id: 4242,
			login: 'CanonicalLogin',
			type: 'User',
		})

		const response = await createOrganization('old-login', owner.headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		// The message names the handle the user typed; GitHub follows rename
		// redirects, so the canonical login may differ from it.
		expect(body.message).toContain('old-login')
	})

	test('allows an existing login claimed by the linked GitHub account case-insensitively', async () => {
		await db.insert(account).values({
			accountId: '4242',
			providerId: 'github',
			userId: owner.id,
		})
		lookupLogin.mockResolvedValue({
			exists: true,
			id: 4242,
			login: 'TesseraClaimed',
			type: 'User',
		})
		expect(
			(await createOrganization('tesseraclaimed', owner.headers)).status
		).toBe(200)
	})

	test('creates when GitHub reports the login missing', async () => {
		lookupLogin.mockResolvedValue({ exists: false })

		expect(
			(await createOrganization('github-free', owner.headers)).status
		).toBe(200)
	})

	test.each([
		['transport failure', undefined],
		['rate limit', 429],
	] as const)('fails closed on a GitHub %s without creating a row', async (_label, status) => {
		lookupLogin.mockRejectedValue(
			new GitHubLookupUnavailableError(status ? { status } : undefined)
		)

		const response = await createOrganization(
			'github-unavailable',
			owner.headers
		)
		expect(response.status).toBe(503)
		expect(await countOrganizations('github-unavailable')).toBe(0)
	})

	test('settles concurrent creation of one slug with one winner', async () => {
		const responses = await Promise.all([
			createOrganization('concurrent', owner.headers),
			createOrganization('concurrent', outsider.headers),
		])
		const statuses = responses.map(response => response.status).sort()

		expect(statuses).toEqual([200, 409])
		const losingResponse = responses.find(response => response.status === 409)
		expect(losingResponse).toBeDefined()
		expect(await losingResponse?.json()).toMatchObject({
			code: 'CONFLICT',
			message: 'This handle is already taken by a user or organization.',
		})
		expect(await countOrganizations('concurrent')).toBe(1)
	})

	test('masks an organization from a non-member', async () => {
		const created = await createOrganizationBody('private-org', owner.headers)

		const response = await getOrganization(
			created.organization.id,
			outsider.headers
		)
		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' })
	})

	test('re-runs the GitHub guard on rename and leaves the organization unchanged', async () => {
		const created = await createOrganizationBody('before-rename', owner.headers)
		lookupLogin.mockResolvedValue({
			exists: true,
			id: 4242,
			login: 'BlockedRename',
			type: 'Organization',
		})

		const response = await updateOrganization(
			created.organization.id,
			{ slug: 'blocked-rename' },
			owner.headers
		)

		expect(response.status).toBe(409)
		expect(
			await db.query.organization.findFirst({
				where: eq(organization.id, created.organization.id),
			})
		).toMatchObject({ slug: 'before-rename' })
	})

	test('allows an admin to rename and forbids a member', async () => {
		const created = await createOrganizationBody('role-rename', owner.headers)
		await seedMember(created.organization.id, admin.id, 'admin')
		await seedMember(created.organization.id, regularMember.id, 'member')

		expect(
			(
				await updateOrganization(
					created.organization.id,
					{ slug: 'admin-renamed' },
					admin.headers
				)
			).status
		).toBe(200)

		const memberResponse = await updateOrganization(
			created.organization.id,
			{ name: 'Member edit' },
			regularMember.headers
		)
		expect(memberResponse.status).toBe(403)
		expect(
			await db.query.organization.findFirst({
				where: eq(organization.id, created.organization.id),
			})
		).toMatchObject({ slug: 'admin-renamed', name: 'Tessera' })
	})

	test('blocks deletion while the organization owns repositories', async () => {
		const created = await createOrganizationBody('repo-owner', owner.headers)
		await db.insert(repositories).values({
			slug: 'notes' as RepositorySlug,
			name: 'Notes' as RepositoryName,
			visibility: 'private',
			ownerOrganizationId: created.organization.id,
		})

		const response = await deleteOrganization(
			created.organization.id,
			'repo-owner',
			owner.headers
		)
		expect(response.status).toBe(409)
		expect(await response.json()).toMatchObject({ code: 'CONFLICT' })
		expect(await countOrganizations('repo-owner')).toBe(1)
	})

	test('allows an owner to delete an empty organization and removes related rows', async () => {
		const created = await createOrganizationBody('delete-empty', owner.headers)
		const retained = await createOrganizationBody('keep-org', outsider.headers)
		await seedMember(created.organization.id, admin.id, 'admin')
		await db.insert(invitation).values([
			{
				email: 'invitee@example.com',
				inviterId: owner.id,
				organizationId: created.organization.id,
				role: 'member',
				expiresAt: new Date(Date.now() + 86_400_000),
			},
			{
				email: 'retained@example.com',
				inviterId: outsider.id,
				organizationId: retained.organization.id,
				role: 'member',
				expiresAt: new Date(Date.now() + 86_400_000),
			},
		])

		const response = await deleteOrganization(
			created.organization.id,
			'delete-empty',
			owner.headers
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ deleted: true })
		expect(await countOrganizations('delete-empty')).toBe(0)
		expect(await countMembers(created.organization.id)).toBe(0)
		expect(await countInvitations(created.organization.id)).toBe(0)
		expect(await countOrganizations('keep-org')).toBe(1)
		expect(await countMembers(retained.organization.id)).toBe(1)
		expect(await countInvitations(retained.organization.id)).toBe(1)
	})

	test('forbids deletion by an admin', async () => {
		const created = await createOrganizationBody('admin-delete', owner.headers)
		await seedMember(created.organization.id, admin.id, 'admin')

		const response = await deleteOrganization(
			created.organization.id,
			'admin-delete',
			admin.headers
		)
		expect(response.status).toBe(403)
		expect(await countOrganizations('admin-delete')).toBe(1)
	})

	test('rejects an incorrect deletion confirmation', async () => {
		const created = await createOrganizationBody(
			'confirm-delete',
			owner.headers
		)

		const response = await deleteOrganization(
			created.organization.id,
			'wrong',
			owner.headers
		)
		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			code: 'BAD_REQUEST',
			message: 'Type the organization handle to confirm.',
		})
		expect(await countOrganizations('confirm-delete')).toBe(1)
	})

	async function createIntegrationUser(
		username: string
	): Promise<IntegrationUser> {
		const token = crypto.randomUUID()
		const [createdUser] = await db
			.insert(user)
			.values({
				name: username,
				email: `${username}@example.com`,
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

		return { id: createdUser.id, headers, username }
	}

	function createOrganization(slug: string, headers: Headers) {
		return request('http://localhost/organizations', 'POST', headers, {
			name: 'Tessera',
			slug,
		})
	}

	async function createOrganizationBody(slug: string, headers: Headers) {
		const response = await createOrganization(slug, headers)

		if (response.status !== 200)
			throw new Error(`Failed to create organization: ${response.status}`)

		return (await response.json()) as OrganizationResponse
	}

	function listOrganizations(headers: Headers) {
		return adapter.hono.request('http://localhost/organizations', { headers })
	}

	function getOrganization(organizationId: OrganizationId, headers: Headers) {
		return adapter.hono.request(
			`http://localhost/organizations/${organizationId}`,
			{ headers }
		)
	}

	function updateOrganization(
		organizationId: OrganizationId,
		body: object,
		headers: Headers
	) {
		return request(
			`http://localhost/organizations/${organizationId}`,
			'PATCH',
			headers,
			body
		)
	}

	function deleteOrganization(
		organizationId: OrganizationId,
		confirmationSlug: string,
		headers: Headers
	) {
		return request(
			`http://localhost/organizations/${organizationId}`,
			'DELETE',
			headers,
			{ confirmationSlug }
		)
	}

	function request(
		url: string,
		method: 'DELETE' | 'PATCH' | 'POST',
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

	async function seedMember(
		organizationId: OrganizationId,
		userId: UserId,
		role: 'admin' | 'member'
	) {
		await db.insert(member).values({ organizationId, userId, role })
	}

	async function countOrganizations(slug: string) {
		const [row] = await db
			.select({ value: count() })
			.from(organization)
			.where(eq(organization.slug, slug))

		return row?.value ?? 0
	}

	async function countMembers(organizationId: OrganizationId) {
		const [row] = await db
			.select({ value: count() })
			.from(member)
			.where(eq(member.organizationId, organizationId))

		return row?.value ?? 0
	}

	async function countInvitations(organizationId: OrganizationId) {
		const [row] = await db
			.select({ value: count() })
			.from(invitation)
			.where(eq(invitation.organizationId, organizationId))

		return row?.value ?? 0
	}

	async function resetIntegrationDatabase() {
		await db.delete(repositories)
		await db.delete(invitation)
		await db.delete(member)
		await db.delete(organization)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}

	async function clearOrganizationCache() {
		await cacheRedis.del(...GITHUB_CACHE_KEYS)
	}
})
