import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { status } from '@grpc/grpc-js'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { eq, type GitHubInstallationId, sql } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	gitHubInstallations,
	member,
	organization,
	repositories,
	repositoryExternalSources,
	session,
	user,
} from '@repo/db/schema'
import type {
	OrganizationId,
	RepositoryId,
	RepositoryName,
	RepositorySlug,
	UserId,
} from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { ExternalServiceError } from '~/shared/errors'
import { mockRepositoryCommit } from '~/shared/mocks/repository-commit.mock'

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
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
class RepositoriesIntegrationTestModule {}

interface RepositoryResponseBody {
	repository: {
		id: string
		slug: string
		name: string
		visibility: 'public' | 'private'
		description?: string
		defaultBranch: string
		externalSource: {
			mode: 'none' | 'imported' | 'github_to_tessera' | 'tessera_source'
			provider?: 'github'
			externalRepositoryId?: string
			ownerLogin?: string
			name?: string
			fullName?: string
			sourceUrl?: string
			sourceDefaultBranch?: string
			syncStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
			lastSyncStartedAt?: string
			lastSyncSucceededAt?: string
			lastSyncFailedAt?: string
			nextSyncAt?: string
			syncFailureReason?: string
			cutoverActorUserId?: string
			cutoverAt?: string
			cutoverFromMirrorMode?:
				| 'imported'
				| 'github_to_tessera'
				| 'tessera_source'
			createdAt?: string
			updatedAt?: string
		}
		createdAt: string
		updatedAt: string
	}
	owner: {
		kind: 'user' | 'organization'
		handle: string
		username: string
	}
}

interface RepositoryListResponseBody {
	repositories: RepositoryResponseBody[]
}

interface RepositoryTreeEntryResponseBody {
	name: string
	objectId: string
	kind: 'directory' | 'file' | 'submodule' | 'symlink' | 'unknown'
	sizeBytes: number
	path: string
	mode: string
}

interface RepositoryBrowserSummaryResponseBody extends RepositoryResponseBody {
	isEmpty: boolean
	defaultBranch: string
	selectedRef?: RepositoryRefResponseBody
	branches: RepositoryBranchRefResponseBody[]
	tags: RepositoryTagRefResponseBody[]
	rootEntries: RepositoryTreeEntryResponseBody[]
	readme?: {
		filename: string
		objectId: string
		content: string
		isTruncated: boolean
	}
}

interface RepositoryBranchRefResponseBody {
	type: 'branch'
	name: string
	qualifiedName: string
	target: string
}

interface RepositoryTagRefResponseBody {
	type: 'tag'
	name: string
	qualifiedName: string
	target: string
}

type RepositoryRefResponseBody =
	| RepositoryBranchRefResponseBody
	| RepositoryTagRefResponseBody

interface RepositoryTreeResponseBody extends RepositoryResponseBody {
	ref: string
	commitId: string
	path: string
	entries: RepositoryTreeEntryResponseBody[]
}

type RepositoryBlobPreviewResponseBody =
	| {
			type: 'text'
			content: string
	  }
	| {
			type: 'binary'
	  }
	| {
			type: 'tooLarge'
			previewLimitBytes: number
	  }

interface RepositoryBlobResponseBody extends RepositoryResponseBody {
	ref: string
	path: string
	name: string
	objectId: string
	sizeBytes: number
	preview: RepositoryBlobPreviewResponseBody
}

interface RepositoryCommitHistoryResponseBody extends RepositoryResponseBody {
	ref: string
	commits: (typeof mockRepositoryCommit)[]
}

interface RepositoryRefsResponseBody extends RepositoryResponseBody {
	branches: RepositoryBranchRefResponseBody[]
	tags: RepositoryTagRefResponseBody[]
}

interface ErrorResponseBody {
	defined: false
	code: string
	status: number
	message: string
}

interface CreateIntegrationUserOptions {
	username: string
	email: string
	name?: string
}

interface CreateIntegrationExternalSourceOptions {
	repositoryId: RepositoryId
	externalRepositoryId?: bigint
	installationId?: GitHubInstallationId
	mirrorMode?: 'imported' | 'github_to_tessera' | 'tessera_source'
	ownerLogin?: string
	slug?: string
	syncStatus?: 'pending' | 'running' | 'succeeded' | 'failed'
	nextSyncAt?: Date | null
	lastSyncSucceededAt?: Date
}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

describe('Repositories integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let gitStorageCreateRepository: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryBrowserSummary: ReturnType<typeof vi.fn>
	let gitStorageListRepositoryRefs: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryTree: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryBlob: ReturnType<typeof vi.fn>
	let gitStorageGetRepositoryRawBlob: ReturnType<typeof vi.fn>
	let gitStorageListRepositoryCommits: ReturnType<typeof vi.fn>

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		gitStorageCreateRepository = vi.fn(({ repositoryId }) =>
			Promise.resolve({
				storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
			})
		)
		gitStorageGetRepositoryBrowserSummary = vi.fn().mockResolvedValue({
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'readme123',
				content: '# Notes',
				isTruncated: false,
			},
		})
		gitStorageListRepositoryRefs = vi.fn().mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
		})
		gitStorageGetRepositoryTree = vi.fn().mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 4,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		gitStorageGetRepositoryBlob = vi.fn().mockResolvedValue({
			objectId: 'blob123',
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
			sizeBytes: 17,
		})
		gitStorageGetRepositoryRawBlob = vi.fn().mockResolvedValue({
			objectId: 'blob123',
			content: new Uint8Array([0, 1, 2, 255]),
			sizeBytes: 4,
		})
		gitStorageListRepositoryCommits = vi.fn().mockResolvedValue({
			commits: [mockRepositoryCommit],
		})

		moduleRef = await Test.createTestingModule({
			imports: [RepositoriesIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: gitStorageCreateRepository,
				getRepositoryBrowserSummary: gitStorageGetRepositoryBrowserSummary,
				listRepositoryRefs: gitStorageListRepositoryRefs,
				getRepositoryTree: gitStorageGetRepositoryTree,
				getRepositoryBlob: gitStorageGetRepositoryBlob,
				getRepositoryRawBlob: gitStorageGetRepositoryRawBlob,
				listRepositoryCommits: gitStorageListRepositoryCommits,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)

		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		gitStorageCreateRepository.mockReset()
		gitStorageGetRepositoryBrowserSummary.mockReset()
		gitStorageListRepositoryRefs.mockReset()
		gitStorageGetRepositoryTree.mockReset()
		gitStorageGetRepositoryBlob.mockReset()
		gitStorageGetRepositoryRawBlob.mockReset()
		gitStorageListRepositoryCommits.mockReset()
		gitStorageCreateRepository.mockImplementation(({ repositoryId }) =>
			Promise.resolve({
				storagePath: `/var/lib/tessera/repositories/${repositoryId}.git`,
			})
		)
		gitStorageGetRepositoryBrowserSummary.mockResolvedValue({
			isEmpty: false,
			defaultBranch: 'main',
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'readme123',
				content: '# Notes',
				isTruncated: false,
			},
		})
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
		})
		gitStorageGetRepositoryTree.mockResolvedValue({
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 4,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		gitStorageGetRepositoryBlob.mockResolvedValue({
			objectId: 'blob123',
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
			sizeBytes: 17,
		})
		gitStorageGetRepositoryRawBlob.mockResolvedValue({
			objectId: 'blob123',
			content: new Uint8Array([0, 1, 2, 255]),
			sizeBytes: 4,
		})
		gitStorageListRepositoryCommits.mockResolvedValue({
			commits: [mockRepositoryCommit],
		})
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('rejects unauthenticated create requests', async () => {
		const response = await createRepository({ name: 'Notes' })
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('creates an authenticated repository with a generated slug', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository(
			{ name: ' Tessera Notes ' },
			headers
		)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'tessera-notes',
				name: 'Tessera Notes',
				visibility: 'private',
				defaultBranch: 'main',
			},
			owner: {
				kind: 'user',
				handle: 'marta',
				username: 'marta',
			},
		})
		expect(body.repository.id).toEqual(expect.any(String))
		expect(Date.parse(body.repository.createdAt)).not.toBeNaN()
		expect(gitStorageCreateRepository).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
		})
	})

	test.each([
		'owner',
		'admin',
	] as const)('creates an organization-owned repository as an organization %s', async role => {
		const actor = await createIntegrationUser(`org-${role}`)
		const organizationId = await createIntegrationOrganization('tessera')
		await seedOrganizationMember(organizationId, actor.id, role)

		const response = await createRepository(
			{
				name: 'Organization Notes',
				slug: 'notes',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body.owner).toEqual({
			kind: 'organization',
			handle: 'tessera',
			username: 'tessera',
		})
		expect(body.repository.slug).toBe('notes')
	})

	test.each([
		['member', true, 'member'],
		['outsider', true, undefined],
		['unknown organization', false, undefined],
	] as const)('returns forbidden when a %s creates an organization-owned repository', async (_label, organizationExists, role) => {
		const actor = await createIntegrationUser('actor')
		const organizationId = organizationExists
			? await createIntegrationOrganization('tessera')
			: (crypto.randomUUID() as OrganizationId)
		if (role) await seedOrganizationMember(organizationId, actor.id, role)

		const response = await createRepository(
			{
				name: 'Organization Notes',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)

		expect(response.status).toBe(403)
		expect(await response.json()).toMatchObject({
			code: 'FORBIDDEN',
			message: 'repository administration access denied',
		})
		expect(gitStorageCreateRepository).not.toHaveBeenCalled()
	})

	test('allows the same repository slug under a user and an organization', async () => {
		const actor = await createIntegrationUser('marta')
		const organizationId = await createIntegrationOrganization('tessera')
		await seedOrganizationMember(organizationId, actor.id, 'owner')

		const userResponse = await createRepository(
			{ name: 'Personal Notes', slug: 'notes' },
			actor.headers
		)
		const organizationResponse = await createRepository(
			{
				name: 'Organization Notes',
				slug: 'notes',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)

		expect(userResponse.status).toBe(200)
		expect(organizationResponse.status).toBe(200)
		expect((await userResponse.json()) as RepositoryResponseBody).toMatchObject(
			{
				owner: { kind: 'user', handle: 'marta', username: 'marta' },
			}
		)
		expect(
			(await organizationResponse.json()) as RepositoryResponseBody
		).toMatchObject({
			owner: {
				kind: 'organization',
				handle: 'tessera',
				username: 'tessera',
			},
		})
	})

	test.each([
		'owner',
		'admin',
	] as const)('lists only organization repositories for an organization %s', async role => {
		const actor = await createIntegrationUser(`org-${role}`)
		const organizationId = await createIntegrationOrganization('tessera')
		await seedOrganizationMember(organizationId, actor.id, role)
		await createRepository(
			{ name: 'Personal', slug: 'personal' },
			actor.headers
		)
		await createRepository(
			{
				name: 'Notes',
				slug: 'notes',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)
		await createRepository(
			{
				name: 'Roadmap',
				slug: 'roadmap',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)

		const response = await listRepositories('tessera', actor.headers)
		const body = (await response.json()) as RepositoryListResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories.map(({ repository }) => repository.slug)).toEqual([
			'notes',
			'roadmap',
		])
		expect(
			body.repositories.every(
				({ owner }) =>
					owner.kind === 'organization' && owner.handle === 'tessera'
			)
		).toBeTruthy()
	})

	test.each([
		['member', true],
		['outsider', false],
	] as const)('hides an organization repository list from an organization %s', async (_label, seedMembership) => {
		const actor = await createIntegrationUser('actor')
		const organizationId = await createIntegrationOrganization('tessera')
		if (seedMembership)
			await seedOrganizationMember(organizationId, actor.id, 'member')

		const response = await listRepositories('tessera', actor.headers)

		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' })
	})

	test('uses the user first when a user and organization share a handle', async () => {
		const actor = await createIntegrationUser('shared')
		const organizationId = await createIntegrationOrganization('shared')
		await seedOrganizationMember(organizationId, actor.id, 'owner')
		const userCreateResponse = await createRepository(
			{ name: 'User Notes', slug: 'notes' },
			actor.headers
		)
		await createRepository(
			{
				name: 'Organization Notes',
				slug: 'notes',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)
		const userRepository =
			(await userCreateResponse.json()) as RepositoryResponseBody

		const getResponse = await getRepository('shared', 'notes', actor.headers)
		const listResponse = await listRepositories('shared', actor.headers)
		const listed = (await listResponse.json()) as RepositoryListResponseBody

		expect(getResponse.status).toBe(200)
		expect(await getResponse.json()).toMatchObject({
			repository: { id: userRepository.repository.id, name: 'User Notes' },
			owner: { kind: 'user', handle: 'shared', username: 'shared' },
		})
		expect(listResponse.status).toBe(200)
		expect(listed.repositories).toHaveLength(1)
		expect(listed.repositories[0]).toMatchObject({
			repository: { id: userRepository.repository.id },
			owner: { kind: 'user', handle: 'shared', username: 'shared' },
		})
	})

	test('lets an organization admin use repository details and GitHub settings', async () => {
		const actor = await createIntegrationUser('admin')
		const organizationId = await createIntegrationOrganization('tessera')
		await seedOrganizationMember(organizationId, actor.id, 'admin')
		await createRepository(
			{
				name: 'Imported',
				slug: 'imported',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)
		await createRepository(
			{
				name: 'Mirror',
				slug: 'mirror',
				owner: { kind: 'organization', organizationId },
			},
			actor.headers
		)
		const importedRepository = await getRepositoryRow('imported')
		const mirroredRepository = await getRepositoryRow('mirror')
		const installationId = await createIntegrationGitHubInstallation()
		await createIntegrationExternalSource({
			repositoryId: importedRepository.id,
			externalRepositoryId: 123n,
			installationId,
			mirrorMode: 'imported',
			slug: 'imported',
		})
		await createIntegrationExternalSource({
			repositoryId: mirroredRepository.id,
			externalRepositoryId: 456n,
			mirrorMode: 'github_to_tessera',
			slug: 'mirror',
			lastSyncSucceededAt: new Date(),
		})

		const getResponse = await getRepository(
			'tessera',
			'imported',
			actor.headers
		)
		const enableResponse = await enableGitHubMirror(
			'tessera',
			'imported',
			actor.headers
		)
		const healthResponse = await getGitHubSyncHealth(
			'tessera',
			'mirror',
			actor.headers
		)
		const reauthorizationResponse = await getGitHubReauthorization(
			'tessera',
			'mirror',
			actor.headers
		)
		const cutoverResponse = await cutoverGitHubMirror(
			'tessera',
			'mirror',
			actor.headers
		)

		expect(getResponse.status).toBe(200)
		expect(await getResponse.json()).toMatchObject({
			owner: {
				kind: 'organization',
				handle: 'tessera',
				username: 'tessera',
			},
		})
		expect(enableResponse.status).toBe(200)
		expect(await enableResponse.json()).toEqual({ status: 'enabled' })
		expect(healthResponse.status).toBe(200)
		expect(await healthResponse.json()).toEqual({
			syncHealth: expect.objectContaining({ state: 'healthy' }),
		})
		expect(reauthorizationResponse.status).toBe(200)
		expect(await reauthorizationResponse.json()).toEqual({
			reauthorizationRequired: false,
		})
		expect(cutoverResponse.status).toBe(200)
		expect(await cutoverResponse.json()).toMatchObject({
			repository: { externalSource: { mode: 'tessera_source' } },
			owner: { kind: 'organization', handle: 'tessera' },
		})
	})

	test.each([
		['GET', ''],
		['POST', '/github-mirror/enable'],
		['GET', '/github-mirror/health'],
		['GET', '/github-mirror/reauthorization'],
		['POST', '/cutover'],
	] as const)('hides repository administration from an organization member using %s /repositories/:owner/:slug%s', async (method, suffix) => {
		const actor = await createIntegrationUser('member')
		const organizationId = await createIntegrationOrganization('tessera')
		await seedOrganizationMember(organizationId, actor.id, 'member')
		await seedOrganizationRepository(organizationId, 'notes')

		const response = await requestRepositoryProcedure({
			method,
			path: `tessera/notes${suffix}`,
			headers: actor.headers,
		})

		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' })
	})

	test.each([
		['GET', ''],
		['POST', '/github-mirror/enable'],
		['GET', '/github-mirror/health'],
		['GET', '/github-mirror/reauthorization'],
		['POST', '/cutover'],
	] as const)('hides repository administration from an organization outsider using %s /repositories/:owner/:slug%s', async (method, suffix) => {
		const actor = await createIntegrationUser('outsider')
		const organizationId = await createIntegrationOrganization('tessera')
		await seedOrganizationRepository(organizationId, 'notes')

		const response = await requestRepositoryProcedure({
			method,
			path: `tessera/notes${suffix}`,
			headers: actor.headers,
		})

		expect(response.status).toBe(404)
		expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' })
	})

	test('re-authorizes every guarded procedure against decoded input instead of only its path', async () => {
		const attacker = await createIntegrationUser('attacker')
		const victim = await createIntegrationUser('victim')
		for (const slug of ['details', 'imported', 'mirror']) {
			await createRepository({ name: slug, slug }, attacker.headers)
			await createRepository({ name: slug, slug }, victim.headers)
		}
		const victimImportedRepository = await getRepositoryRowForOwner(
			victim.id,
			'imported'
		)
		const victimMirroredRepository = await getRepositoryRowForOwner(
			victim.id,
			'mirror'
		)
		const installationId = await createIntegrationGitHubInstallation()
		await createIntegrationExternalSource({
			repositoryId: victimImportedRepository.id,
			externalRepositoryId: 123n,
			installationId,
			mirrorMode: 'imported',
			slug: 'imported',
			ownerLogin: 'victim',
		})
		await createIntegrationExternalSource({
			repositoryId: victimMirroredRepository.id,
			externalRepositoryId: 456n,
			mirrorMode: 'github_to_tessera',
			slug: 'mirror',
			ownerLogin: 'victim',
			lastSyncSucceededAt: new Date(),
		})
		const attacks = [
			{ method: 'GET', path: 'attacker/details', slug: 'details' },
			{
				method: 'POST',
				path: 'attacker/imported/github-mirror/enable',
				slug: 'imported',
			},
			{
				method: 'GET',
				path: 'attacker/mirror/github-mirror/health',
				slug: 'mirror',
			},
			{
				method: 'GET',
				path: 'attacker/mirror/github-mirror/reauthorization',
				slug: 'mirror',
			},
			{
				method: 'POST',
				path: 'attacker/mirror/cutover',
				slug: 'mirror',
			},
		] as const

		for (const attack of attacks) {
			const input = { username: 'victim', slug: attack.slug }
			const response = await requestRepositoryProcedure({
				method: attack.method,
				path: attack.path,
				headers: attacker.headers,
				body: attack.method === 'POST' ? input : undefined,
				query: attack.method === 'GET' ? input : undefined,
			})

			expect(response.status).toBe(404)
			expect(await response.json()).toMatchObject({ code: 'NOT_FOUND' })
		}

		expect(
			await db.query.repositoryExternalSources.findFirst({
				where: eq(
					repositoryExternalSources.repositoryId,
					victimImportedRepository.id
				),
			})
		).toMatchObject({ mirrorMode: 'imported' })
		expect(
			await db.query.repositoryExternalSources.findFirst({
				where: eq(
					repositoryExternalSources.repositoryId,
					victimMirroredRepository.id
				),
			})
		).toMatchObject({ mirrorMode: 'github_to_tessera', cutoverAt: null })
	})

	test('cuts over a succeeded GitHub mirror to Tessera source and preserves GitHub metadata', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const repository = await getRepositoryRow('notes')
		const actor = await getUserRow('marta')

		// Nothing here records a sync attempt, which is what every mirror that
		// existed before attempts were kept looks like. Health is derived from the
		// source row alone in that case, so cutover still goes through.
		await createIntegrationExternalSource({
			repositoryId: repository.id,
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncSucceededAt: new Date(),
			nextSyncAt: new Date('2026-05-12T00:15:00Z'),
		})

		const response = await cutoverGitHubMirror('marta', 'notes', headers)
		const body = (await response.json()) as RepositoryResponseBody
		const externalSource = await db.query.repositoryExternalSources.findFirst({
			where: eq(repositoryExternalSources.repositoryId, repository.id),
		})

		expect(response.status).toBe(200)
		expect(body.repository.externalSource).toMatchObject({
			mode: 'tessera_source',
			provider: 'github',
			externalRepositoryId: '123',
			ownerLogin: 'marta',
			name: 'notes',
			fullName: 'marta/notes',
			sourceUrl: 'https://github.com/marta/notes',
			sourceDefaultBranch: 'main',
			syncStatus: 'succeeded',
			cutoverActorUserId: actor.id,
			cutoverFromMirrorMode: 'github_to_tessera',
		})
		expect(
			Date.parse(body.repository.externalSource.cutoverAt ?? '')
		).not.toBeNaN()
		expect(externalSource).toEqual(
			expect.objectContaining({
				mirrorMode: 'tessera_source',
				nextSyncAt: null,
				cutoverActorUserId: actor.id,
				cutoverAt: expect.any(Date),
				cutoverFromMirrorMode: 'github_to_tessera',
				externalRepositoryId: 123n,
				ownerLogin: 'marta',
				name: 'notes',
				fullName: 'marta/notes',
				sourceUrl: 'https://github.com/marta/notes',
				sourceDefaultBranch: 'main',
			})
		)
	})

	test('rejects unauthenticated GitHub mirror cutover requests', async () => {
		const response = await cutoverGitHubMirror('marta', 'notes')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('hides another username when cutting over GitHub mirrors', async () => {
		const renHeaders = await createIntegrationSessionHeaders({
			username: 'ren',
			email: 'ren@example.com',
		})
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, renHeaders)
		const repository = await getRepositoryRow('notes')
		await createIntegrationExternalSource({ repositoryId: repository.id })

		const response = await cutoverGitHubMirror('ren', 'notes', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	test('rejects cutover for non-mirrored repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)

		const response = await cutoverGitHubMirror('marta', 'notes', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
	})

	test('rejects cutover while GitHub mirror sync is running', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const repository = await getRepositoryRow('notes')

		await createIntegrationExternalSource({
			repositoryId: repository.id,
			mirrorMode: 'github_to_tessera',
			syncStatus: 'running',
		})

		const response = await cutoverGitHubMirror('marta', 'notes', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body.code).toBe('CONFLICT')
	})

	test('reports a mirror with no recorded attempts as healthy', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const repository = await getRepositoryRow('notes')

		await createIntegrationExternalSource({
			repositoryId: repository.id,
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncSucceededAt: new Date(),
		})

		// The attempts table enriches health, it does not gate it. Every mirror
		// that predates it has no rows, and reading that as unhealthy would block
		// cutover for all of them until their first reconciliation after deploy.
		expect(
			await (await getGitHubSyncHealth('marta', 'notes', headers)).json()
		).toEqual({
			syncHealth: expect.objectContaining({
				state: 'healthy',
				retryCount24h: 0,
				failureRate24h: 0,
				pendingDeliveryCount: 0,
				reauthorizationRequired: false,
			}),
		})
	})

	test('rejects cutover of a mirror that has not reconciled in hours', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const repository = await getRepositoryRow('notes')

		await createIntegrationExternalSource({
			repositoryId: repository.id,
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
			lastSyncSucceededAt: new Date('2026-05-12T00:01:00Z'),
		})

		// The stored status still says the last run succeeded. Cutting over on that
		// alone would freeze whatever GitHub changed since into Tessera for good,
		// so a stale mirror waits for its next successful reconciliation.
		expect((await cutoverGitHubMirror('marta', 'notes', headers)).status).toBe(
			400
		)
		expect(
			await (await getGitHubSyncHealth('marta', 'notes', headers)).json()
		).toEqual({
			syncHealth: expect.objectContaining({ state: 'stale' }),
		})
	})

	test('rejects cutover when latest GitHub mirror sync failed', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const repository = await getRepositoryRow('notes')

		await createIntegrationExternalSource({
			repositoryId: repository.id,
			mirrorMode: 'github_to_tessera',
			syncStatus: 'failed',
		})

		const response = await cutoverGitHubMirror('marta', 'notes', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
	})

	test('rejects invalid create input before creating git storage', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository({ name: '' }, headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
		expect(gitStorageCreateRepository).not.toHaveBeenCalled()
	})

	test('creates a repository with a normalized custom slug', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository(
			{
				name: 'Roadmap',
				slug: '  Release Roadmap!!  ',
				description: 'Launch notes',
				visibility: 'public',
			},
			headers
		)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body.repository).toMatchObject({
			slug: 'release-roadmap',
			name: 'Roadmap',
			description: 'Launch notes',
			visibility: 'public',
		})
	})

	test('cleans up metadata when git storage creation fails', async () => {
		gitStorageCreateRepository.mockRejectedValueOnce(
			new ExternalServiceError('git storage')
		)
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await createRepository({ name: 'Notes' }, headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(502)
		expect(body).toMatchObject({
			code: 'BAD_GATEWAY',
			message: 'git storage request failed',
		})
		expect(await db.query.repositories.findMany()).toHaveLength(0)
	})

	test('rejects duplicate slugs for the same user', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		const response = await createRepository(
			{ name: 'More Notes', slug: 'notes' },
			headers
		)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body).toMatchObject({
			code: 'CONFLICT',
			message: 'repository slug already exists',
		})
	})

	test('allows the same slug for different users', async () => {
		const martaHeaders = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const renHeaders = await createIntegrationSessionHeaders({
			username: 'ren',
			email: 'ren@example.com',
		})

		expect(
			(await createRepository({ name: 'Notes', slug: 'notes' }, martaHeaders))
				.status
		).toBe(200)
		expect(
			(await createRepository({ name: 'Notes', slug: 'notes' }, renHeaders))
				.status
		).toBe(200)
	})

	test('lists repositories for the current username', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes' }, headers)
		await createRepository({ name: 'Roadmap' }, headers)

		const response = await listRepositories('marta', headers)
		const body = (await response.json()) as RepositoryListResponseBody

		expect(response.status).toBe(200)
		expect(body.repositories).toHaveLength(2)
		expect(body.repositories.map(item => item.repository.slug).sort()).toEqual([
			'notes',
			'roadmap',
		])
		expect(
			body.repositories.every(item => item.owner.username === 'marta')
		).toBeTruthy()
	})

	test('rejects unauthenticated repository list requests', async () => {
		const response = await listRepositories('marta')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('hides another username when listing repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await listRepositories('ren', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	test('gets an owned repository by owner username and slug', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', description: 'Project notes', visibility: 'public' },
			headers
		)

		const response = await getRepository('marta', 'notes', headers)
		const body = (await response.json()) as RepositoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toEqual({
			repository: {
				id: expect.any(String),
				slug: 'notes',
				name: 'Notes',
				visibility: 'public',
				description: 'Project notes',
				defaultBranch: 'main',
				externalSource: { mode: 'none' },
				cloneUrls: {
					authority: 'tessera',
					https: 'http://localhost:4001/marta/notes.git',
					ssh: 'ssh://git@localhost:2222/marta/notes.git',
				},
				createdAt: expect.any(String),
				updatedAt: expect.any(String),
			},
			owner: {
				kind: 'user',
				handle: 'marta',
				username: 'marta',
			},
		})
		expect(Date.parse(body.repository.createdAt)).not.toBeNaN()
		expect(Date.parse(body.repository.updatedAt)).not.toBeNaN()
	})

	test('rejects unauthenticated repository detail requests', async () => {
		const response = await getRepository('marta', 'notes')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(401)
		expect(body).toMatchObject({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		})
	})

	test('hides another username when getting repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes' }, headers)

		const response = await getRepository('ren', 'notes', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	test('returns not found for an unknown owned repository', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		const response = await getRepository('marta', 'missing', headers)
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
	})

	test('returns public repository browser summary for anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getBrowserSummary('marta', 'notes')
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				name: 'Notes',
				visibility: 'public',
				defaultBranch: 'main',
			},
			owner: {
				username: 'marta',
			},
			isEmpty: false,
			defaultBranch: 'main',
			selectedRef: {
				type: 'branch',
				name: 'main',
				qualifiedName: 'refs/heads/main',
				target: 'commit123',
			},
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
			rootEntries: [
				{
					name: 'src',
					objectId: 'tree123',
					kind: 'directory',
					sizeBytes: 0,
					path: 'src',
					mode: '040000',
				},
			],
			readme: {
				filename: 'README.md',
				objectId: 'readme123',
				content: '# Notes',
				isTruncated: false,
			},
		})
		expect(gitStorageGetRepositoryBrowserSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: body.repository.id,
				defaultBranch: 'main',
			})
		)
		expect(gitStorageListRepositoryRefs).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
			storagePath: `/var/lib/tessera/repositories/${body.repository.id}.git`,
			trustedGpgKeys: [],
		})
	})

	test('returns private repository browser summary for the owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)

		const response = await getBrowserSummary('marta', 'notes', headers)
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				visibility: 'private',
			},
			owner: {
				username: 'marta',
			},
		})
	})

	test('returns repository refs for public repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getRefs('marta', 'notes')
		const body = (await response.json()) as RepositoryRefsResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				visibility: 'public',
			},
			owner: {
				username: 'marta',
			},
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [],
		})
		expect(gitStorageListRepositoryRefs).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
			storagePath: `/var/lib/tessera/repositories/${body.repository.id}.git`,
			trustedGpgKeys: [],
		})
	})

	test('hides private repository refs from anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		gitStorageListRepositoryRefs.mockClear()

		const response = await getRefs('marta', 'notes')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
		expect(gitStorageListRepositoryRefs).not.toHaveBeenCalled()
	})

	test('returns selected branch browser summaries', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
				{
					type: 'branch',
					name: 'develop',
					qualifiedName: 'refs/heads/develop',
					target: 'develop123',
				},
			],
			tags: [],
		})

		const response = await getBrowserSummary('marta', 'notes', undefined, {
			ref: 'develop',
		})
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body.selectedRef).toEqual({
			type: 'branch',
			name: 'develop',
			qualifiedName: 'refs/heads/develop',
			target: 'develop123',
		})
		expect(gitStorageGetRepositoryBrowserSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: 'refs/heads/develop',
			})
		)
	})

	test('returns selected tag browser summaries', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [
				{
					type: 'branch',
					name: 'main',
					qualifiedName: 'refs/heads/main',
					target: 'commit123',
				},
			],
			tags: [
				{
					type: 'tag',
					name: 'v1.0.0',
					qualifiedName: 'refs/tags/v1.0.0',
					target: 'tag123',
				},
			],
		})

		const response = await getBrowserSummary('marta', 'notes', undefined, {
			ref: 'v1.0.0',
		})
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body.selectedRef).toEqual({
			type: 'tag',
			name: 'v1.0.0',
			qualifiedName: 'refs/tags/v1.0.0',
			target: 'tag123',
		})
		expect(gitStorageGetRepositoryBrowserSummary).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: 'refs/tags/v1.0.0',
			})
		)
	})

	test('returns bad request for unknown selected browser refs', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)
		gitStorageGetRepositoryBrowserSummary.mockClear()

		const response = await getBrowserSummary('marta', 'notes', undefined, {
			ref: 'missing',
		})
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
		expect(gitStorageGetRepositoryBrowserSummary).not.toHaveBeenCalled()
	})

	test('returns empty ref lists in empty browser summaries', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)
		gitStorageListRepositoryRefs.mockResolvedValue({
			branches: [],
			tags: [],
		})
		gitStorageGetRepositoryBrowserSummary.mockResolvedValue({
			isEmpty: true,
			defaultBranch: 'main',
			rootEntries: [],
			readme: undefined,
		})

		const response = await getBrowserSummary('marta', 'notes')
		const body = (await response.json()) as RepositoryBrowserSummaryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			isEmpty: true,
			branches: [],
			tags: [],
			rootEntries: [],
		})
		expect(body).not.toHaveProperty('selectedRef')
		expect(body).not.toHaveProperty('readme')
	})

	test('hides private repository browser summary from anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		gitStorageGetRepositoryBrowserSummary.mockClear()

		const response = await getBrowserSummary('marta', 'notes')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
		expect(gitStorageGetRepositoryBrowserSummary).not.toHaveBeenCalled()
	})

	test('rejects invalid repository browser inputs before git storage reads', async () => {
		const response = await getBrowserSummary('marta', 'bad_slug')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
		expect(gitStorageGetRepositoryBrowserSummary).not.toHaveBeenCalled()
	})

	test('returns repository tree entries for public repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getTree('marta', 'notes', 'main', 'src')
		const body = (await response.json()) as RepositoryTreeResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
			},
			owner: {
				username: 'marta',
			},
			ref: 'main',
			commitId: 'commit123',
			path: 'src',
			entries: [
				{
					name: 'index.ts',
					objectId: 'blob123',
					kind: 'file',
					sizeBytes: 4,
					path: 'src/index.ts',
					mode: '100644',
				},
			],
		})
		expect(gitStorageGetRepositoryTree).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: body.repository.id,
				ref: 'main',
				path: 'src',
			})
		)
	})

	test('returns blob previews for public repositories', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getBlob('marta', 'notes', 'main', 'src/index.ts')
		const body = (await response.json()) as RepositoryBlobResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
			},
			owner: {
				username: 'marta',
			},
			ref: 'main',
			path: 'src/index.ts',
			name: 'index.ts',
			objectId: 'blob123',
			sizeBytes: 17,
			preview: {
				type: 'text',
				content: 'console.log("hi")',
			},
		})
		expect(gitStorageGetRepositoryTree).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: 'main',
				path: 'src',
			})
		)
		expect(gitStorageGetRepositoryBlob).toHaveBeenCalledWith(
			expect.objectContaining({
				repositoryId: body.repository.id,
				objectId: 'blob123',
			})
		)
	})

	test('returns raw blob bytes from the HTTP raw route', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getRawBlob('marta', 'notes', 'main', 'src/index.ts')

		expect(response.status).toBe(200)
		expect(response.headers.get('content-type')).toBe(
			'application/octet-stream'
		)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([0, 1, 2, 255])
		)
		expect(gitStorageGetRepositoryTree).toHaveBeenCalledWith(
			expect.objectContaining({
				ref: 'main',
				path: 'src',
			})
		)
		expect(gitStorageGetRepositoryRawBlob).toHaveBeenCalledWith(
			expect.objectContaining({
				objectId: 'blob123',
			})
		)
	})

	test('returns private raw blob bytes to the repository owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)

		const response = await getRawBlob(
			'marta',
			'notes',
			'main',
			'src/index.ts',
			headers
		)

		expect(response.status).toBe(200)
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(
			new Uint8Array([0, 1, 2, 255])
		)
		expect(gitStorageGetRepositoryRawBlob).toHaveBeenCalledWith(
			expect.objectContaining({
				objectId: 'blob123',
			})
		)
	})

	test('returns public repository commit history for anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)

		const response = await getCommitHistory('marta', 'notes', 'main', {
			limit: 10,
		})
		const body = (await response.json()) as RepositoryCommitHistoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				visibility: 'public',
			},
			owner: {
				username: 'marta',
			},
			ref: 'main',
			commits: [mockRepositoryCommit],
		})
		expect(gitStorageListRepositoryCommits).toHaveBeenCalledWith({
			repositoryId: body.repository.id,
			storagePath: `/var/lib/tessera/repositories/${body.repository.id}.git`,
			ref: 'main',
			limit: 10,
			trustedGpgKeys: [],
		})
	})

	test('returns private repository commit history for the owner', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)

		const response = await getCommitHistory('marta', 'notes', 'main', {
			headers,
		})
		const body = (await response.json()) as RepositoryCommitHistoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			repository: {
				slug: 'notes',
				visibility: 'private',
			},
			ref: 'main',
			commits: [mockRepositoryCommit],
		})
	})

	test('hides private repository commit history from anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		gitStorageListRepositoryCommits.mockClear()

		const response = await getCommitHistory('marta', 'notes', 'main')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
		expect(gitStorageListRepositoryCommits).not.toHaveBeenCalled()
	})

	test('returns empty repository commit history', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)
		gitStorageListRepositoryCommits.mockResolvedValue({ commits: [] })

		const response = await getCommitHistory('marta', 'notes', 'main')
		const body = (await response.json()) as RepositoryCommitHistoryResponseBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			ref: 'main',
			commits: [],
		})
	})

	test('returns bad request for invalid commit history refs', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository(
			{ name: 'Notes', slug: 'notes', visibility: 'public' },
			headers
		)
		gitStorageListRepositoryCommits.mockRejectedValue(
			new ExternalServiceError('git storage', {
				grpcCode: status.INVALID_ARGUMENT,
			})
		)

		const response = await getCommitHistory('marta', 'notes', '..%2Fmain')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(400)
		expect(body.code).toBe('BAD_REQUEST')
	})

	test('hides private raw blob bytes from anonymous readers', async () => {
		const headers = await createIntegrationSessionHeaders({
			username: 'marta',
			email: 'marta@example.com',
		})
		await createRepository({ name: 'Notes', slug: 'notes' }, headers)
		gitStorageGetRepositoryTree.mockClear()
		gitStorageGetRepositoryRawBlob.mockClear()

		const response = await getRawBlob('marta', 'notes', 'main', 'src/index.ts')
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(404)
		expect(body).toMatchObject({
			code: 'NOT_FOUND',
			message: 'repository not found',
		})
		expect(gitStorageGetRepositoryTree).not.toHaveBeenCalled()
		expect(gitStorageGetRepositoryRawBlob).not.toHaveBeenCalled()
	})

	async function createIntegrationSessionHeaders(
		options: CreateIntegrationUserOptions
	) {
		return (await createIntegrationUser(options)).headers
	}

	async function createIntegrationUser(
		options: CreateIntegrationUserOptions | string
	): Promise<IntegrationUser> {
		const normalizedOptions =
			typeof options === 'string'
				? { username: options, email: `${options}@example.com` }
				: options
		const token = crypto.randomUUID()
		const createdUsers = await db
			.insert(user)
			.values({
				name: normalizedOptions.name ?? normalizedOptions.username,
				email: normalizedOptions.email,
				emailVerified: true,
				username: normalizedOptions.username,
			})
			.returning({ id: user.id })
		const createdUser = createdUsers[0]

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

		return {
			id: createdUser.id,
			headers,
			username: normalizedOptions.username,
		}
	}

	async function resetIntegrationDatabase() {
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(gitHubInstallations)
		await db.delete(member)
		await db.delete(organization)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}

	async function getRepositoryRow(slug: string) {
		const repository = await db.query.repositories.findFirst({
			where: sql`${repositories.slug} = ${slug}`,
		})

		if (!repository) throw new Error('Failed to create repository')

		return repository
	}

	async function getRepositoryRowForOwner(userId: UserId, slug: string) {
		const repository = await db.query.repositories.findFirst({
			where: sql`${repositories.ownerUserId} = ${userId} and ${repositories.slug} = ${slug}`,
		})

		if (!repository) throw new Error('Failed to create repository')

		return repository
	}

	async function getUserRow(username: string) {
		const createdUser = await db.query.user.findFirst({
			where: sql`${user.username} = ${username}`,
		})

		if (!createdUser) throw new Error('Failed to create integration user')

		return createdUser
	}

	async function createIntegrationExternalSource({
		externalRepositoryId = 123n,
		installationId,
		lastSyncSucceededAt = new Date('2026-05-12T00:01:00Z'),
		mirrorMode = 'github_to_tessera',
		nextSyncAt,
		ownerLogin = 'marta',
		repositoryId,
		slug = 'notes',
		syncStatus = 'succeeded',
	}: CreateIntegrationExternalSourceOptions) {
		await db.insert(repositoryExternalSources).values({
			repositoryId,
			provider: 'github',
			installationId,
			externalRepositoryId,
			ownerLogin,
			name: slug,
			fullName: `${ownerLogin}/${slug}`,
			sourceUrl: `https://github.com/${ownerLogin}/${slug}`,
			sourceDefaultBranch: 'main',
			mirrorMode,
			syncStatus,
			nextSyncAt,
			lastSyncSucceededAt:
				syncStatus === 'succeeded' ? lastSyncSucceededAt : undefined,
			lastSyncStartedAt:
				syncStatus === 'running' ? new Date('2026-05-12T00:01:00Z') : undefined,
		})
	}

	async function createIntegrationOrganization(
		slug: string
	): Promise<OrganizationId> {
		const [createdOrganization] = await db
			.insert(organization)
			.values({ name: slug, slug })
			.returning({ id: organization.id })

		if (!createdOrganization)
			throw new Error('Failed to create integration organization')

		return createdOrganization.id
	}

	async function seedOrganizationMember(
		organizationId: OrganizationId,
		userId: UserId,
		role: 'owner' | 'admin' | 'member'
	) {
		await db.insert(member).values({ organizationId, userId, role })
	}

	async function seedOrganizationRepository(
		organizationId: OrganizationId,
		slug: string
	) {
		await db.insert(repositories).values({
			ownerOrganizationId: organizationId,
			ownerUserId: null,
			name: slug as RepositoryName,
			slug: slug as RepositorySlug,
			storagePath: `/var/lib/tessera/repositories/${slug}.git`,
		})
	}

	async function createIntegrationGitHubInstallation() {
		const [installation] = await db
			.insert(gitHubInstallations)
			.values({
				externalInstallationId: 123n,
				accountNodeId: 'organization-node',
				accountLogin: 'tessera',
				targetType: 'organization',
			})
			.returning({ id: gitHubInstallations.id })

		if (!installation) throw new Error('Failed to create GitHub installation')

		return installation.id
	}

	function createRepository(input: object, headers?: Headers) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request('http://localhost/repositories', {
			method: 'POST',
			headers: requestHeaders,
			body: JSON.stringify(input),
		})
	}

	function listRepositories(username: string, headers?: Headers) {
		return adapter.hono.request(`http://localhost/repositories/${username}`, {
			headers,
		})
	}

	function getRepository(username: string, slug: string, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}`,
			{ headers }
		)
	}

	function cutoverGitHubMirror(
		username: string,
		slug: string,
		headers?: Headers
	) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/cutover`,
			{ method: 'POST', headers }
		)
	}

	function enableGitHubMirror(
		username: string,
		slug: string,
		headers?: Headers
	) {
		return requestRepositoryProcedure({
			method: 'POST',
			path: `${username}/${slug}/github-mirror/enable`,
			headers,
		})
	}

	function getGitHubSyncHealth(
		username: string,
		slug: string,
		headers?: Headers
	) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/github-mirror/health`,
			{ headers }
		)
	}

	function getGitHubReauthorization(
		username: string,
		slug: string,
		headers?: Headers
	) {
		return requestRepositoryProcedure({
			method: 'GET',
			path: `${username}/${slug}/github-mirror/reauthorization`,
			headers,
		})
	}

	function requestRepositoryProcedure({
		body,
		headers,
		method,
		path,
		query,
	}: {
		body?: object
		headers?: Headers
		method: 'GET' | 'POST'
		path: string
		query?: Record<string, string>
	}) {
		const requestHeaders = new Headers(headers)
		if (body) requestHeaders.set('content-type', 'application/json')
		const searchParams = new URLSearchParams(query)
		const queryString = searchParams.size ? `?${searchParams.toString()}` : ''

		return adapter.hono.request(
			`http://localhost/repositories/${path}${queryString}`,
			{
				method,
				headers: requestHeaders,
				body: body ? JSON.stringify(body) : undefined,
			}
		)
	}

	function getRefs(username: string, slug: string, headers?: Headers) {
		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/refs`,
			{ headers }
		)
	}

	function getBrowserSummary(
		username: string,
		slug: string,
		headers?: Headers,
		options: { ref?: string } = {}
	) {
		const searchParams = new URLSearchParams()
		if (options.ref) searchParams.set('ref', options.ref)
		const query = searchParams.size ? `?${searchParams.toString()}` : ''

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/browser${query}`,
			{ headers }
		)
	}

	function getTree(
		username: string,
		slug: string,
		ref: string,
		path?: string,
		headers?: Headers
	) {
		const searchParams = new URLSearchParams()
		if (path) searchParams.set('path', path)
		const query = searchParams.size ? `?${searchParams.toString()}` : ''

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/tree/${ref}${query}`,
			{ headers }
		)
	}

	function getBlob(
		username: string,
		slug: string,
		ref: string,
		path: string,
		headers?: Headers
	) {
		const searchParams = new URLSearchParams({ path })

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/blob/${ref}?${searchParams.toString()}`,
			{ headers }
		)
	}

	function getRawBlob(
		username: string,
		slug: string,
		ref: string,
		path: string,
		headers?: Headers
	) {
		const searchParams = new URLSearchParams({ path })

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/raw/${ref}?${searchParams.toString()}`,
			{ headers }
		)
	}

	function getCommitHistory(
		username: string,
		slug: string,
		ref: string,
		options: { headers?: Headers; limit?: number } = {}
	) {
		const searchParams = new URLSearchParams()
		if (options.limit !== undefined)
			searchParams.set('limit', String(options.limit))
		const query = searchParams.size ? `?${searchParams.toString()}` : ''

		return adapter.hono.request(
			`http://localhost/repositories/${username}/${slug}/commits/${encodeURIComponent(ref)}${query}`,
			{ headers: options.headers }
		)
	}
})
