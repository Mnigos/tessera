import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { RedisModule } from '@config/redis'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { HandlesModule } from '@modules/handles'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { db } from '@repo/db/client'
import {
	account,
	member,
	organization,
	repositories,
	repositoryCollaborators,
	session,
	user,
} from '@repo/db/schema'
import type {
	OrganizationId,
	OrganizationRole,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
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
		GitStorageModule,
		RPCModule,
		AuthModule,
		HandlesModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class HandlesIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface HandleResponseBody {
	owner:
		| {
				kind: 'user'
				user: { id: UserId; username: string }
				viewerRole?: 'self'
		  }
		| {
				kind: 'organization'
				organization: { id: OrganizationId; slug: string }
				viewerRole?: OrganizationRole
		  }
	repositories: { id: RepositoryId; slug: string; visibility: string }[]
}

describe('Handles integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let alice: IntegrationUser
	let organizationOwner: IntegrationUser
	let organizationAdmin: IntegrationUser
	let organizationMember: IntegrationUser
	let organizationMemberCollaborator: IntegrationUser
	let outsider: IntegrationUser
	let readCollaborator: IntegrationUser
	let writeCollaborator: IntegrationUser
	let adminCollaborator: IntegrationUser
	let organizationId: OrganizationId

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		moduleRef = await Test.createTestingModule({
			imports: [HandlesIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()

		alice = await createIntegrationUser('alice')
		organizationOwner = await createIntegrationUser('acme-owner')
		organizationAdmin = await createIntegrationUser('acme-admin')
		organizationMember = await createIntegrationUser('acme-member')
		organizationMemberCollaborator = await createIntegrationUser(
			'acme-member-collaborator'
		)
		outsider = await createIntegrationUser('outsider')
		readCollaborator = await createIntegrationUser('read-collaborator')
		writeCollaborator = await createIntegrationUser('write-collaborator')
		adminCollaborator = await createIntegrationUser('admin-collaborator')

		const [createdOrganization] = await db
			.insert(organization)
			.values({ name: 'Acme', slug: 'acme' })
			.returning({ id: organization.id })
		if (!createdOrganization) throw new Error('Failed to create organization')
		organizationId = createdOrganization.id

		await db.insert(member).values([
			{
				organizationId,
				userId: organizationOwner.id,
				role: 'owner',
			},
			{
				organizationId,
				userId: organizationAdmin.id,
				role: 'admin',
			},
			{
				organizationId,
				userId: organizationMember.id,
				role: 'member',
			},
			{
				organizationId,
				userId: organizationMemberCollaborator.id,
				role: 'member',
			},
		])

		const createdAt = new Date('2026-08-16T10:00:00.000Z')
		const seededRepositories = await db
			.insert(repositories)
			.values([
				{
					name: 'Alice Public' as RepositoryName,
					slug: 'user-public' as RepositorySlug,
					visibility: 'public',
					ownerUserId: alice.id,
					storagePath: '/repositories/user-public.git',
					createdAt,
				},
				{
					name: 'Alice Private' as RepositoryName,
					slug: 'user-private' as RepositorySlug,
					visibility: 'private',
					ownerUserId: alice.id,
					storagePath: '/repositories/user-private.git',
					createdAt: new Date(createdAt.getTime() + 1000),
				},
				{
					name: 'Acme Public' as RepositoryName,
					slug: 'org-public' as RepositorySlug,
					visibility: 'public',
					ownerOrganizationId: organizationId,
					storagePath: '/repositories/org-public.git',
					createdAt: new Date(createdAt.getTime() + 2000),
				},
				{
					name: 'Acme Private' as RepositoryName,
					slug: 'org-private' as RepositorySlug,
					visibility: 'private',
					ownerOrganizationId: organizationId,
					storagePath: '/repositories/org-private.git',
					createdAt: new Date(createdAt.getTime() + 3000),
				},
			])
			.returning({ id: repositories.id, slug: repositories.slug })

		const privateRepositories = seededRepositories.filter(repositoryRow =>
			repositoryRow.slug.endsWith('-private')
		)
		const collaborators = [
			{ userId: readCollaborator.id, role: 'read' as const },
			{ userId: writeCollaborator.id, role: 'write' as const },
			{ userId: adminCollaborator.id, role: 'admin' as const },
			{
				userId: organizationMemberCollaborator.id,
				role: 'read' as const,
			},
		]
		await db.insert(repositoryCollaborators).values(
			privateRepositories.flatMap(repositoryRow =>
				collaborators.map(collaboratorRow => ({
					repositoryId: repositoryRow.id,
					...collaboratorRow,
				}))
			)
		)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test.each([
		['unknown', 'unknown'],
		['whitespace-only', '   '],
	])('returns 404 for a %s handle', async (_label, handle) => {
		const response = await getHandle(handle)

		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({
			code: 'NOT_FOUND',
			status: 404,
		})
	})

	test('normalizes surrounding whitespace and casing', async () => {
		const response = await getHandle('  ALICE  ')

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			owner: { kind: 'user', user: { username: 'alice' } },
		})
	})

	test.each([
		['self', (): Headers | undefined => alice.headers, 'self'],
		['another user', (): Headers | undefined => outsider.headers, undefined],
		['anonymous', (): Headers | undefined => undefined, undefined],
	] as const)('returns the user handle with %s viewer role', async (_label, getHeaders, viewerRole) => {
		const response = await getHandle('alice', getHeaders())
		const body = (await response.json()) as HandleResponseBody

		expect(response.status).toBe(200)
		expect(body.owner).toMatchObject({
			kind: 'user',
			user: { id: alice.id, username: 'alice' },
		})
		if (viewerRole) expect(body.owner).toHaveProperty('viewerRole', viewerRole)
		else expect(body.owner).not.toHaveProperty('viewerRole')
	})

	test.each([
		['owner', (): Headers | undefined => organizationOwner.headers, 'owner'],
		['admin', (): Headers | undefined => organizationAdmin.headers, 'admin'],
		['member', (): Headers | undefined => organizationMember.headers, 'member'],
		['outsider', (): Headers | undefined => outsider.headers, undefined],
		['anonymous', (): Headers | undefined => undefined, undefined],
	] as const)('returns the organization handle for an %s viewer', async (_label, getHeaders, viewerRole) => {
		const response = await getHandle('acme', getHeaders())
		const body = (await response.json()) as HandleResponseBody

		expect(response.status).toBe(200)
		expect(body.owner).toMatchObject({
			kind: 'organization',
			organization: { id: organizationId, slug: 'acme' },
		})
		if (viewerRole) expect(body.owner).toHaveProperty('viewerRole', viewerRole)
		else expect(body.owner).not.toHaveProperty('viewerRole')
	})

	test.each([
		[
			'anonymous',
			(): Headers | undefined => undefined,
			['user-public'],
			['org-public'],
		],
		[
			'non-member',
			(): Headers | undefined => outsider.headers,
			['user-public'],
			['org-public'],
		],
		[
			'member',
			(): Headers | undefined => organizationMember.headers,
			['user-public'],
			['org-public'],
		],
		[
			'admin',
			(): Headers | undefined => organizationAdmin.headers,
			['user-public'],
			['org-public', 'org-private'],
		],
		[
			'owner',
			(): Headers | undefined => organizationOwner.headers,
			['user-public'],
			['org-public', 'org-private'],
		],
		[
			'read collaborator',
			(): Headers | undefined => readCollaborator.headers,
			['user-public', 'user-private'],
			['org-public', 'org-private'],
		],
		[
			'write collaborator',
			(): Headers | undefined => writeCollaborator.headers,
			['user-public', 'user-private'],
			['org-public', 'org-private'],
		],
		[
			'admin collaborator',
			(): Headers | undefined => adminCollaborator.headers,
			['user-public', 'user-private'],
			['org-public', 'org-private'],
		],
		[
			'organization member collaborator',
			(): Headers | undefined => organizationMemberCollaborator.headers,
			['user-public', 'user-private'],
			['org-public', 'org-private'],
		],
		[
			'owning user',
			(): Headers | undefined => alice.headers,
			['user-public', 'user-private'],
			['org-public'],
		],
	] as const)('returns exactly the repositories visible to the %s', async (_label, getHeaders, expectedUserRepositories, expectedOrganizationRepositories) => {
		const headers = getHeaders()
		const [userResponse, organizationResponse] = await Promise.all([
			getHandle('alice', headers),
			getHandle('acme', headers),
		])
		const userBody = (await userResponse.json()) as HandleResponseBody
		const organizationBody =
			(await organizationResponse.json()) as HandleResponseBody

		expect(userBody.repositories.map(repository => repository.slug)).toEqual(
			expectedUserRepositories
		)
		expect(
			organizationBody.repositories.map(repository => repository.slug)
		).toEqual(expectedOrganizationRepositories)
	})

	test('prefers a user when an organization shares the handle', async () => {
		await db.insert(organization).values({ name: 'Alice Org', slug: 'alice' })

		const response = await getHandle('alice')

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			owner: { kind: 'user', user: { id: alice.id } },
		})
	})

	test('rejects a reserved handle on organization create and rename', async () => {
		const [renameOrganization] = await db
			.insert(organization)
			.values({ name: 'Rename Me', slug: 'rename-me' })
			.returning({ id: organization.id })
		if (!renameOrganization) throw new Error('Failed to create rename fixture')
		await db.insert(member).values({
			organizationId: renameOrganization.id,
			userId: organizationOwner.id,
			role: 'owner',
		})

		const [createResponse, renameResponse] = await Promise.all([
			request(
				'http://localhost/organizations',
				'POST',
				organizationOwner.headers,
				{
					name: 'Reserved',
					slug: 'profile',
				}
			),
			request(
				`http://localhost/organizations/${renameOrganization.id}`,
				'PATCH',
				organizationOwner.headers,
				{ slug: 'settings' }
			),
		])

		expect(createResponse.status).toBe(409)
		expect(renameResponse.status).toBe(409)
		expect(await createResponse.json()).toMatchObject({ code: 'CONFLICT' })
		expect(await renameResponse.json()).toMatchObject({ code: 'CONFLICT' })
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

	function getHandle(handle: string, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/handles/${encodeURIComponent(handle)}`,
			{ headers }
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

	async function resetIntegrationDatabase() {
		await db.delete(repositoryCollaborators)
		await db.delete(repositories)
		await db.delete(member)
		await db.delete(organization)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})
