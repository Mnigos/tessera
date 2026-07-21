import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { RepositoryCollaboratorsModule } from '@modules/repository-collaborators'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	pullRequestEvents,
	pullRequests,
	repositories,
	repositoryCollaborators,
	repositoryEvents,
	repositoryExternalSources,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type { UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		GitStorageModule,
		RPCModule,
		AuthModule,
		RepositoriesModule,
		RepositoryCollaboratorsModule,
		PullRequestsModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class RepositoryCollaboratorsIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
}

describe('Repository collaborators integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let gitStorageListRepositoryRefs: ReturnType<typeof vi.fn>
	let gitStorageMergeRepositoryRefs: ReturnType<typeof vi.fn>
	let owner: IntegrationUser
	let adminCollaborator: IntegrationUser
	let writeCollaborator: IntegrationUser
	let readCollaborator: IntegrationUser
	let outsider: IntegrationUser

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		gitStorageListRepositoryRefs = vi.fn()
		gitStorageMergeRepositoryRefs = vi.fn()
		moduleRef = await Test.createTestingModule({
			imports: [RepositoryCollaboratorsIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId: id }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${id}.git`,
					})
				),
				listRepositoryRefs: gitStorageListRepositoryRefs,
				mergeRepositoryRefs: gitStorageMergeRepositoryRefs,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		gitStorageListRepositoryRefs.mockReset()
		gitStorageMergeRepositoryRefs.mockReset()
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'base-sha',
				},
				{
					type: 'branch',
					name: 'feature',
					qualifiedName: 'refs/heads/feature',
					target: 'head-sha',
				},
			],
			tags: [],
		})

		owner = await createIntegrationUser('owner')
		adminCollaborator = await createIntegrationUser('admin')
		writeCollaborator = await createIntegrationUser('writer')
		readCollaborator = await createIntegrationUser('reader')
		outsider = await createIntegrationUser('outsider')

		const response = await createRepository(
			{ name: 'Private Notes', slug: 'notes', visibility: 'private' },
			owner.headers
		)
		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('adds and lists a collaborator while recording an added event', async () => {
		const addResponse = await addCollaborator(
			writeCollaborator.username,
			'write',
			owner.headers
		)
		expect(addResponse.status).toBe(200)

		const listResponse = await listCollaborators(owner.headers)
		expect(listResponse.status).toBe(200)
		expect(await listResponse.json()).toMatchObject({
			collaborators: [{ username: writeCollaborator.username, role: 'write' }],
		})

		const event = await findRepositoryEvent('collaborator_added')
		expect(event).toMatchObject({
			actorUserId: owner.id,
			payload: {
				type: 'collaborator_added',
				collaboratorUserId: writeCollaborator.id,
				role: 'write',
			},
		})
	})

	test('rejects adding the same collaborator twice', async () => {
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)

		const response = await addCollaborator(
			writeCollaborator.username,
			'write',
			owner.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body.code).toBe('CONFLICT')
	})

	test('rejects adding an unknown username', async () => {
		const response = await addCollaborator('unknown', 'write', owner.headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body.code).toBe('NOT_FOUND')
	})

	test('rejects adding the repository owner as a collaborator', async () => {
		const response = await addCollaborator(
			owner.username,
			'write',
			owner.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
	})

	test('updates a collaborator role while recording a role-changed event', async () => {
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)

		const response = await updateCollaboratorRole(
			writeCollaborator.username,
			'admin',
			owner.headers
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			username: writeCollaborator.username,
			role: 'admin',
		})

		const event = await findRepositoryEvent('collaborator_role_changed')
		expect(event).toMatchObject({
			actorUserId: owner.id,
			payload: {
				type: 'collaborator_role_changed',
				collaboratorUserId: writeCollaborator.id,
				previousRole: 'write',
				role: 'admin',
			},
		})
	})

	test('keeps the current role without recording a role-changed event', async () => {
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)

		const response = await updateCollaboratorRole(
			writeCollaborator.username,
			'write',
			owner.headers
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({
			username: writeCollaborator.username,
			role: 'write',
		})
		expect(
			await findRepositoryEvent('collaborator_role_changed')
		).toBeUndefined()
	})

	test('rejects updating the role of a user who is not a collaborator', async () => {
		const response = await updateCollaboratorRole(
			outsider.username,
			'write',
			owner.headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body.code).toBe('NOT_FOUND')
	})

	test('rejects removing a user who is not a collaborator', async () => {
		const response = await removeCollaborator(outsider.username, owner.headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body.code).toBe('NOT_FOUND')
	})

	test('removes a collaborator while recording a removed event', async () => {
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)

		const removeResponse = await removeCollaborator(
			writeCollaborator.username,
			owner.headers
		)
		expect(removeResponse.status).toBe(200)
		expect(await removeResponse.json()).toEqual({ success: true })

		const listResponse = await listCollaborators(owner.headers)
		expect(await listResponse.json()).toEqual({ collaborators: [] })

		const event = await findRepositoryEvent('collaborator_removed')
		expect(event).toMatchObject({
			actorUserId: owner.id,
			payload: {
				type: 'collaborator_removed',
				collaboratorUserId: writeCollaborator.id,
				role: 'write',
			},
		})
	})

	test('allows a write collaborator to create, edit, close, and reopen a pull request', async () => {
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)

		const createResponse = await createPullRequest(writeCollaborator.headers)
		expect(createResponse.status).toBe(200)

		const editResponse = await editPullRequest(writeCollaborator.headers)
		expect(editResponse.status).toBe(200)
		expect(await editResponse.json()).toMatchObject({ title: 'Updated' })

		const closeResponse = await transitionPullRequest(
			'close',
			writeCollaborator.headers
		)
		expect(closeResponse.status).toBe(200)
		expect(await closeResponse.json()).toMatchObject({ state: 'closed' })

		const reopenResponse = await transitionPullRequest(
			'reopen',
			writeCollaborator.headers
		)
		expect(reopenResponse.status).toBe(200)
		expect(await reopenResponse.json()).toMatchObject({ state: 'open' })
	})

	test('allows a write collaborator to merge a pull request', async () => {
		const baseSha = 'a'.repeat(40)
		const headSha = 'b'.repeat(40)
		const mergeCommitSha = 'c'.repeat(40)
		gitStorageMergeRepositoryRefs.mockResolvedValue(mergeCommitSha)
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)
		await createPullRequest(owner.headers)

		const mergeResponse = await mergePullRequest(writeCollaborator.headers, {
			expectedBaseSha: baseSha,
			expectedHeadSha: headSha,
		})

		expect(mergeResponse.status).toBe(200)
		expect(await mergeResponse.json()).toMatchObject({
			state: 'merged',
			mergeCommitSha,
		})
		expect(gitStorageMergeRepositoryRefs).toHaveBeenCalledWith(
			expect.objectContaining({
				expectedBaseSha: baseSha,
				expectedHeadSha: headSha,
			})
		)

		const mergedPullRequest = await db.query.pullRequests.findFirst({
			where: eq(pullRequests.mergeCommitSha, mergeCommitSha),
		})
		expect(mergedPullRequest).toMatchObject({
			state: 'merged',
			mergeActorUserId: writeCollaborator.id,
		})
	})

	test('allows a read collaborator to list and get pull requests but forbids creating one', async () => {
		await addCollaborator(readCollaborator.username, 'read', owner.headers)
		await createPullRequest(owner.headers)

		expect((await listPullRequests(readCollaborator.headers)).status).toBe(200)
		expect((await getPullRequest(readCollaborator.headers)).status).toBe(200)

		const response = await createPullRequest(readCollaborator.headers)
		const body = (await response.json()) as ErrorResponseBody
		expect(response.status).toBe(403)
		expect(body.code).toBe('FORBIDDEN')
	})

	test('masks pull request list, get, and create from an authenticated outsider', async () => {
		await createPullRequest(owner.headers)

		const listResponse = await listPullRequests(outsider.headers)
		const listBody = (await listResponse.json()) as ErrorResponseBody
		expect(listResponse.status).toBe(404)
		expect(listBody.code).toBe('NOT_FOUND')

		const getResponse = await getPullRequest(outsider.headers)
		const getBody = (await getResponse.json()) as ErrorResponseBody
		expect(getResponse.status).toBe(404)
		expect(getBody.code).toBe('NOT_FOUND')

		const createResponse = await createPullRequest(outsider.headers)
		const createBody = (await createResponse.json()) as ErrorResponseBody
		expect(createResponse.status).toBe(404)
		expect(createBody.code).toBe('NOT_FOUND')
	})

	test('forbids a write collaborator from listing or adding collaborators', async () => {
		await addCollaborator(writeCollaborator.username, 'write', owner.headers)

		const listResponse = await listCollaborators(writeCollaborator.headers)
		const listBody = (await listResponse.json()) as ErrorResponseBody
		expect(listResponse.status).toBe(403)
		expect(listBody.code).toBe('FORBIDDEN')

		const addResponse = await addCollaborator(
			readCollaborator.username,
			'read',
			writeCollaborator.headers
		)
		const addBody = (await addResponse.json()) as ErrorResponseBody
		expect(addResponse.status).toBe(403)
		expect(addBody.code).toBe('FORBIDDEN')
	})

	test('allows an admin collaborator to list and add collaborators', async () => {
		await addCollaborator(adminCollaborator.username, 'admin', owner.headers)

		const listResponse = await listCollaborators(adminCollaborator.headers)
		expect(listResponse.status).toBe(200)

		const addResponse = await addCollaborator(
			readCollaborator.username,
			'read',
			adminCollaborator.headers
		)
		expect(addResponse.status).toBe(200)
		expect(await addResponse.json()).toMatchObject({
			username: readCollaborator.username,
			role: 'read',
		})
	})

	test('revokes private pull request access after removing a read collaborator', async () => {
		await addCollaborator(readCollaborator.username, 'read', owner.headers)
		await createPullRequest(owner.headers)
		await removeCollaborator(readCollaborator.username, owner.headers)

		const response = await listPullRequests(readCollaborator.headers)
		const body = (await response.json()) as ErrorResponseBody
		expect(response.status).toBe(404)
		expect(body.code).toBe('NOT_FOUND')
	})

	test('requires authentication to list collaborators', async () => {
		const response = await listCollaborators()
		expect(response.status).toBe(401)
		expect(await response.json()).toMatchObject({
			defined: false,
			code: 'UNAUTHORIZED',
			status: 401,
		})
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

	async function findRepositoryEvent(
		type:
			| 'collaborator_added'
			| 'collaborator_role_changed'
			| 'collaborator_removed'
	) {
		return await db.query.repositoryEvents.findFirst({
			where: eq(repositoryEvents.type, type),
		})
	}

	async function resetIntegrationDatabase() {
		await db.delete(pullRequestEvents)
		await db.delete(pullRequests)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(repositoryEvents)
		await db.delete(repositoryCollaborators)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}

	function createRepository(input: object, headers: Headers) {
		return request('http://localhost/repositories', 'POST', headers, input)
	}

	function listCollaborators(headers?: Headers) {
		return adapter.hono.request(
			'http://localhost/repositories/owner/notes/collaborators',
			{ headers }
		)
	}

	function addCollaborator(
		collaboratorUsername: string,
		role: 'read' | 'write' | 'admin',
		headers: Headers
	) {
		return request(
			'http://localhost/repositories/owner/notes/collaborators',
			'POST',
			headers,
			{ collaboratorUsername, role }
		)
	}

	function updateCollaboratorRole(
		collaboratorUsername: string,
		role: 'read' | 'write' | 'admin',
		headers: Headers
	) {
		return request(
			`http://localhost/repositories/owner/notes/collaborators/${collaboratorUsername}`,
			'PATCH',
			headers,
			{ role }
		)
	}

	function removeCollaborator(collaboratorUsername: string, headers: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/collaborators/${collaboratorUsername}`,
			{ method: 'DELETE', headers }
		)
	}

	function createPullRequest(headers: Headers) {
		return request(
			'http://localhost/repositories/owner/notes/pulls',
			'POST',
			headers,
			{
				sourceBranch: 'feature',
				targetBranch: 'main',
				title: 'Add feature',
			}
		)
	}

	function listPullRequests(headers: Headers) {
		return adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls',
			{ headers }
		)
	}

	function getPullRequest(headers: Headers) {
		return adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1',
			{ headers }
		)
	}

	function editPullRequest(headers: Headers) {
		return request(
			'http://localhost/repositories/owner/notes/pulls/1',
			'PATCH',
			headers,
			{ title: 'Updated' }
		)
	}

	function transitionPullRequest(action: 'close' | 'reopen', headers: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/1/${action}`,
			{ method: 'POST', headers }
		)
	}

	function mergePullRequest(headers: Headers, input: object) {
		return request(
			'http://localhost/repositories/owner/notes/pulls/1/merge',
			'POST',
			headers,
			input
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
})
