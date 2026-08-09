import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { BranchProtectionModule } from '@modules/branch-protection'
import { CheckStatusesModule } from '@modules/check-statuses'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	apikey,
	branchProtectionRules,
	checkObservations,
	checkStatusCredentials,
	checkStatusProviders,
	checks,
	gitHubCommitStatusMappings,
	mergeQueueEntries,
	pullRequestComments,
	pullRequestEvents,
	pullRequestMergeIntents,
	pullRequestReviewerRequests,
	pullRequestReviews,
	pullRequests,
	pullRequestThreads,
	repositories,
	repositoryCollaborators,
	repositoryEvents,
	repositoryExternalSources,
	repositoryMergeQueueStates,
	repositoryPullRequestCounters,
	session,
	user,
} from '@repo/db/schema'
import type { RepositoryId, UserId } from '@repo/domain'
import { makeSignature } from 'better-auth/crypto'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL('../../../../packages/db/migrations', import.meta.url)
)
const BASE_SHA = 'a'.repeat(40)
const HEAD_SHA = 'b'.repeat(40)
/** The commit the source branch moves to, ageing every result on `HEAD_SHA`. */
const MOVED_HEAD_SHA = 'c'.repeat(40)
const MERGE_COMMIT_SHA = 'd'.repeat(40)

/**
 * The queue's own module is left out — it is the half that needs Redis — and
 * enforcement is decided entirely from the committed rows either way.
 */
@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		GitStorageModule,
		RPCModule,
		AuthModule,
		RepositoriesModule,
		BranchProtectionModule,
		CheckStatusesModule,
		PullRequestsModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class ExternalCommitStatusesIntegrationTestModule {}

interface IntegrationUser {
	id: UserId
	headers: Headers
	username: string
}

interface CreatedCredentialBody {
	token: string
	credential: { id: string; start?: string; enabled: boolean }
	provider: { id: string; key: string; displayName: string }
}

interface PublishedStatusBody {
	checkId: string
	sha: string
	context: string
	state: string
	observedAt: string
	created: boolean
}

interface ChecksListBody {
	checks: {
		context: string
		kind: string
		state: string
		provider: { kind: string; name: string; appSlug?: string }
	}[]
	missingRequiredContexts: { context: string; kind?: string }[]
	headSha: string
	headIsCurrent: boolean
}

interface MergeRequirementsBody {
	eligible: boolean
	reasons: { code: string; contexts?: { state: string }[] }[]
}

describe('External commit statuses integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let mergeRepositoryRefs: ReturnType<typeof vi.fn>
	let currentHeadSha: string
	let owner: IntegrationUser
	let administrator: IntegrationUser
	let repositoryId: RepositoryId
	let otherRepositoryId: RepositoryId
	let importedStatusCounter = 1

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		mergeRepositoryRefs = vi.fn(() => Promise.resolve(MERGE_COMMIT_SHA))
		moduleRef = await Test.createTestingModule({
			imports: [ExternalCommitStatusesIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId: id }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${id}.git`,
					})
				),
				listRepositoryRefs: vi.fn(() =>
					Promise.resolve({
						branches: [
							{
								type: 'branch',
								name: 'main',
								qualifiedName: 'refs/heads/main',
								target: BASE_SHA,
							},
							{
								type: 'branch',
								name: 'feature',
								qualifiedName: 'refs/heads/feature',
								target: currentHeadSha,
							},
						],
						tags: [],
					})
				),
				compareRepositoryRefs: vi.fn(() =>
					Promise.resolve({
						baseSha: BASE_SHA,
						headSha: currentHeadSha,
						mergeBaseSha: BASE_SHA,
						commits: [],
						files: [],
						isTruncated: false,
						commitsTruncated: false,
						commitLimit: 500,
						fileLimit: 300,
					})
				),
				checkRepositoryMergeability: vi.fn(() =>
					Promise.resolve({
						baseSha: BASE_SHA,
						headSha: currentHeadSha,
						mergeBaseSha: BASE_SHA,
						mergeable: true,
						conflictPaths: [],
						conflictPathsTruncated: false,
						conflictPathLimit: 100,
					})
				),
				mergeRepositoryRefs,
			})
			.compile()

		adapter = new HonoAdapter()
		app = moduleRef.createNestApplication(adapter)
		await app.init()
	})

	beforeEach(async () => {
		await resetIntegrationDatabase()
		mergeRepositoryRefs.mockClear()
		currentHeadSha = HEAD_SHA

		owner = await createIntegrationUser('owner')
		administrator = await createIntegrationUser('administrator')
		repositoryId = await createRepository('notes')
		otherRepositoryId = await createRepository('drafts')
		await db
			.insert(repositoryCollaborators)
			.values({ repositoryId, userId: administrator.id, role: 'admin' })
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	// 1
	test('issues a credential whose secret is hashed at rest and shown once', async () => {
		const created = await createProvider()

		expect(created.token.startsWith('tes_status_')).toBeTruthy()
		expect(created.provider.key).toBe('jenkins')

		const [storedKey] = await db
			.select({ key: apikey.key, configId: apikey.configId })
			.from(apikey)

		// The stored value is a hash: it exists, and it is not the secret.
		expect(storedKey?.configId).toBe('status-provider-credentials')
		expect(storedKey?.key).toBeTruthy()
		expect(storedKey?.key).not.toBe(created.token)

		// Listing it back never reproduces the secret.
		const listed = await listProviders()

		expect(JSON.stringify(listed)).not.toContain(created.token)

		// Issuing a credential is a governance change and is audited as one; the
		// statuses it goes on to publish are not.
		const events = await db
			.select({ type: repositoryEvents.type })
			.from(repositoryEvents)
			.where(eq(repositoryEvents.repositoryId, repositoryId))

		expect(events).toEqual([{ type: 'check_status_credential_created' }])
	})

	// 2
	test('accepts a status published to the repository the credential belongs to', async () => {
		const { token } = await createProvider()

		const response = await publishStatus(token, {
			context: 'ci/build',
			state: 'success',
			targetUrl: 'https://ci.example.com/runs/1',
			description: 'All green',
			idempotencyKey: 'build-1',
		})
		const body = (await response.json()) as PublishedStatusBody

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			sha: HEAD_SHA,
			context: 'ci/build',
			state: 'success',
			created: true,
		})

		// The observation names the exact credential that wrote it.
		const [observation] = await db
			.select({ credentialId: checkObservations.credentialId })
			.from(checkObservations)
		const [credential] = await db
			.select({ id: checkStatusCredentials.id })
			.from(checkStatusCredentials)

		expect(observation?.credentialId).toBe(credential?.id)
	})

	// 3
	test('forbids a credential aimed at a different repository', async () => {
		const { token } = await createProvider()

		const response = await publishStatus(token, {
			slug: 'drafts',
			context: 'ci/build',
			state: 'success',
			idempotencyKey: 'build-1',
		})

		expect(response.status).toBe(403)
		expect(await countChecks(otherRepositoryId)).toBe(0)
	})

	// 3b
	test('answers an unknown repository the same way it answers somebody else’s', async () => {
		const { token } = await createProvider()

		const response = await publishStatus(token, {
			slug: 'nothing-here',
			context: 'ci/build',
			state: 'success',
			idempotencyKey: 'build-1',
		})

		// A 404 here would let a valid credential enumerate private repositories.
		expect(response.status).toBe(403)
	})

	// 4
	test('refuses expired, revoked, disabled, wrong-prefix and unknown credentials', async () => {
		const { credential, token } = await createProvider()
		const gitToken = 'tes_git_not-a-status-credential'

		expect((await publishStatus(undefined)).status).toBe(401)
		expect((await publishStatus(gitToken)).status).toBe(401)
		expect((await publishStatus('tes_status_never-issued')).status).toBe(401)

		await db
			.update(apikey)
			.set({ expiresAt: new Date(Date.now() - 60_000) })
			.where(eq(apikey.configId, 'status-provider-credentials'))

		expect((await publishStatus(token)).status).toBe(401)

		await db.update(apikey).set({ expiresAt: null, enabled: false })

		expect((await publishStatus(token)).status).toBe(401)

		await db.update(apikey).set({ enabled: true })
		await revokeCredential(credential.id)

		// Revocation retires both halves: the credential row stops authorizing and
		// the key itself stops authenticating.
		expect((await publishStatus(token)).status).toBe(401)

		const [revokedKey] = await db
			.select({ enabled: apikey.enabled })
			.from(apikey)

		expect(revokedKey?.enabled).toBeFalsy()
		expect(await countChecks(repositoryId)).toBe(0)
	})

	// 4b
	test('refuses a credential whose permission is not checks:write', async () => {
		const { token } = await createProvider()
		await db
			.update(apikey)
			.set({ permissions: JSON.stringify({ checks: ['read'] }) })

		expect((await publishStatus(token)).status).toBe(401)
	})

	// 5
	test('rejects malformed input before anything reaches the ledger', async () => {
		const { token } = await createProvider()
		const invalid = [
			{ sha: 'not-a-sha' },
			{ context: '' },
			{ context: 'x'.repeat(256) },
			{ state: 'exploded' },
			{ targetUrl: 'not-a-url' },
			{ description: 'x'.repeat(1025) },
			{ idempotencyKey: '' },
		]

		for (const overrides of invalid)
			expect(
				(await publishStatus(token, { ...validStatus(), ...overrides })).status
			).toBe(400)

		expect(await countChecks(repositoryId)).toBe(0)
	})

	// 6
	test('replays an identical report under the same key without recording it twice', async () => {
		const { token } = await createProvider()
		const status = validStatus()

		const first = (await (
			await publishStatus(token, status)
		).json()) as PublishedStatusBody
		const second = (await (
			await publishStatus(token, status)
		).json()) as PublishedStatusBody

		expect(first.created).toBeTruthy()
		expect(second.created).toBeFalsy()
		expect(second.state).toBe(first.state)
		expect(second.observedAt).toBe(first.observedAt)
		expect(await countObservations()).toBe(1)
	})

	// 7
	test('refuses a key reused for a different report', async () => {
		const { token } = await createProvider()
		await publishStatus(token, validStatus())

		const response = await publishStatus(token, {
			...validStatus(),
			state: 'failure',
		})

		expect(response.status).toBe(409)
		expect(await countObservations()).toBe(1)
	})

	// 8
	test('appends each transition and resolves the newest as the effective state', async () => {
		const { token } = await createProvider()
		await createPullRequest()

		await publishStatus(token, {
			...validStatus(),
			state: 'pending',
			idempotencyKey: 'build-pending',
		})

		expect((await listChecks(HEAD_SHA)).checks[0]?.state).toBe('pending')

		await publishStatus(token, {
			...validStatus(),
			state: 'success',
			idempotencyKey: 'build-success',
		})

		const { checks: effective } = await listChecks(HEAD_SHA)

		expect(effective).toHaveLength(1)
		expect(effective[0]?.state).toBe('success')
		// Both pages survive; only the newest is effective.
		expect(await countObservations()).toBe(2)
	})

	// 9
	test('keeps a GitHub stream and a native stream sharing a context apart', async () => {
		const { token } = await createProvider()
		await createPullRequest()
		await recordImportedStatus('ci/build', 'failure')

		await publishStatus(token, {
			...validStatus(),
			context: 'ci/build',
			state: 'success',
		})

		const { checks: effective } = await listChecks(HEAD_SHA)

		// Two answers about the same context, not one overwriting the other.
		expect(effective).toHaveLength(2)
		expect(effective.map(check => check.state).sort()).toEqual([
			'failure',
			'success',
		])
		expect(
			effective.find(check => check.provider.kind === 'tessera')
		).toMatchObject({ provider: { name: 'Jenkins', appSlug: 'jenkins' } })
		expect(
			effective.find(check => check.provider.kind === 'github')
		).toBeTruthy()
	})

	// 10
	test('blocks a merge on a native pending, failing, or never-reported requirement', async () => {
		const { token } = await createProvider()
		await createRule([{ context: 'ci/build', kind: 'status' }])
		await createPullRequest()

		// Never reported.
		const missing = await readMergeRequirements()

		expect(missing.eligible).toBeFalsy()
		expect(
			missing.reasons.find(reason => reason.code === 'checks_failed')?.contexts
		).toEqual([expect.objectContaining({ state: 'missing' })])
		expect((await listChecks(HEAD_SHA)).missingRequiredContexts).toEqual([
			{ context: 'ci/build', kind: 'status' },
		])

		await publishStatus(token, {
			...validStatus(),
			state: 'pending',
			idempotencyKey: 'build-pending',
		})
		const pending = await readMergeRequirements()

		expect(pending.eligible).toBeFalsy()
		expect(
			pending.reasons.some(reason => reason.code === 'checks_pending')
		).toBeTruthy()

		await publishStatus(token, {
			...validStatus(),
			state: 'failure',
			idempotencyKey: 'build-failure',
		})
		const failing = await readMergeRequirements()

		expect(failing.eligible).toBeFalsy()
		expect(
			failing.reasons.some(reason => reason.code === 'checks_failed')
		).toBeTruthy()
		expect((await attemptMerge()).status).toBe('blocked')
		expect(mergeRepositoryRefs).not.toHaveBeenCalled()
	})

	// 10b
	test('blocks a merge on a provider-backed stale result', async () => {
		// `stale` is a verdict only the ledger's owner reaches about a result it
		// already holds, so the write API rejects it and the row is placed here
		// directly — the enforcement it drives is the point.
		await createProvider()
		await createRule([{ context: 'ci/build', kind: 'status' }])
		await createPullRequest()
		await recordProviderStatus('ci/build', 'stale')

		const requirements = await readMergeRequirements()

		expect(requirements.eligible).toBeFalsy()
		expect(
			requirements.reasons.find(reason => reason.code === 'checks_failed')
				?.contexts
		).toEqual([expect.objectContaining({ state: 'stale' })])
	})

	// 11
	test('lets a merge through once the native status passes on the current head', async () => {
		const { token } = await createProvider()
		await createRule([{ context: 'ci/build', kind: 'status' }])
		await createPullRequest()

		await publishStatus(token, { ...validStatus(), state: 'success' })
		const requirements = await readMergeRequirements()

		expect(requirements.eligible).toBeTruthy()
		expect((await listChecks(HEAD_SHA)).missingRequiredContexts).toEqual([])
		expect((await attemptMerge()).status).toBe('merged')
	})

	// 12
	test('does not let a pass on the previous head satisfy the current one', async () => {
		const { token } = await createProvider()
		await createRule([{ context: 'ci/build', kind: 'status' }])
		await createPullRequest()
		await publishStatus(token, { ...validStatus(), state: 'success' })

		// The branch moves; the result stays true about the commit it described and
		// stops being an answer about the pull request.
		currentHeadSha = MOVED_HEAD_SHA

		const requirements = await readMergeRequirements()

		expect(requirements.eligible).toBeFalsy()
		expect(
			requirements.reasons.find(reason => reason.code === 'checks_failed')
				?.contexts
		).toEqual([expect.objectContaining({ state: 'missing' })])

		// And nothing rewrote the earlier result to say so.
		const { checks: onOldHead } = await listChecks(HEAD_SHA)

		expect(onOldHead[0]?.state).toBe('success')
		expect(onOldHead[0]?.state).not.toBe('stale')
	})

	test('refuses a real Git access token, not merely a fabricated prefix', async () => {
		// A Git token is a genuine Better Auth key with genuine permissions. It is
		// simply not one of these, and it must not get past the prefix check or
		// the credential lookup.
		const gitToken = await createGitAccessToken()

		expect(gitToken.startsWith('tes_git_')).toBeTruthy()
		expect((await publishStatus(gitToken)).status).toBe(401)
		expect(await countChecks(repositoryId)).toBe(0)
	})

	test('refuses a session cookie in place of a credential', async () => {
		// The publish route carries no session; an admin's browser cookie must not
		// stand in for the repository-confined secret.
		const response = await adapter.hono.request(
			`http://localhost/repositories/owner/notes/commits/${HEAD_SHA}/statuses`,
			{
				method: 'POST',
				headers: new Headers([
					...administrator.headers,
					['content-type', 'application/json'],
				]),
				body: JSON.stringify(validStatus()),
			}
		)

		expect(response.status).toBe(401)
	})

	test('refuses publishing to a repository GitHub is authoritative for', async () => {
		const { token } = await createProvider()
		await makeGitHubAuthoritative()

		// Same refusal as a cross-repository credential: the answer says nothing
		// about how the repository is configured.
		expect((await publishStatus(token)).status).toBe(403)
		expect(await countChecks(repositoryId)).toBe(0)
	})

	test('keeps managing providers on a mirror even though publishing is denied', async () => {
		// The credential is Tessera's own setting; only the status write belongs to
		// GitHub while it is authoritative.
		await makeGitHubAuthoritative()

		const created = await createProvider()

		expect(created.token.startsWith('tes_status_')).toBeTruthy()
	})

	test('denies Better Auth’s own key-management routes to a signed-in user', async () => {
		await createProvider()

		for (const path of [
			'api-key/list',
			'api-key/get',
			'api-key/create',
			'api-key/update',
			'api-key/delete',
		]) {
			const response = await adapter.hono.request(
				`http://localhost/api/auth/${path}`,
				{ method: 'POST', headers: administrator.headers }
			)

			expect(response.status).toBe(404)
		}

		// And the server-side path Tessera itself uses is untouched.
		const { providers } = (await listProviders()) as {
			providers: { credentials: unknown[] }[]
		}

		expect(providers[0]?.credentials).toHaveLength(1)
	})

	test('settles concurrent replays of one key into a single observation', async () => {
		const { token } = await createProvider()
		const status = validStatus()

		const responses = await Promise.all([
			publishStatus(token, status),
			publishStatus(token, status),
			publishStatus(token, status),
		])

		expect(responses.every(response => response.status === 200)).toBeTruthy()
		expect(await countObservations()).toBe(1)
	})

	test('lets a retry succeed after a rejected write left no page behind', async () => {
		const { token } = await createProvider()

		expect(
			(await publishStatus(token, { ...validStatus(), state: 'exploded' }))
				.status
		).toBe(400)

		// The rejected write reserved nothing, so the key is still free to use.
		expect((await publishStatus(token, validStatus())).status).toBe(200)
		expect(await countObservations()).toBe(1)
	})

	test('separates a repeated reportedAt from a changed one', async () => {
		const { token } = await createProvider()
		const reportedAt = '2026-08-08T09:00:00.000Z'
		const status = { ...validStatus(), reportedAt }

		expect((await publishStatus(token, status)).status).toBe(200)
		// The same claim replayed verbatim is the same write.
		expect((await publishStatus(token, status)).status).toBe(200)
		expect(await countObservations()).toBe(1)

		// A different claim under the same key is not.
		expect(
			(
				await publishStatus(token, {
					...status,
					reportedAt: '2026-08-08T09:05:00.000Z',
				})
			).status
		).toBe(409)
	})

	function validStatus() {
		return {
			context: 'ci/build',
			state: 'success',
			idempotencyKey: 'build-1',
		}
	}

	function publishStatus(
		token?: string,
		{
			slug = 'notes',
			sha = HEAD_SHA,
			...body
		}: { slug?: string; sha?: string; [key: string]: unknown } = validStatus()
	) {
		const headers = new Headers({ 'content-type': 'application/json' })

		if (token) headers.set('authorization', `Bearer ${token}`)

		return adapter.hono.request(
			`http://localhost/repositories/owner/${slug}/commits/${sha}/statuses`,
			{ method: 'POST', headers, body: JSON.stringify(body) }
		)
	}

	async function createProvider(): Promise<CreatedCredentialBody> {
		const response = await request(
			'http://localhost/repositories/owner/notes/status-providers',
			'POST',
			administrator.headers,
			{ key: 'jenkins', displayName: 'Jenkins' }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create status provider: ${response.status}`)

		return (await response.json()) as CreatedCredentialBody
	}

	async function createGitAccessToken(): Promise<string> {
		const response = await request(
			'http://localhost/git-access-tokens',
			'POST',
			administrator.headers,
			{ name: 'laptop', permissions: ['git:write'] }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create git access token: ${response.status}`)

		const { token } = (await response.json()) as { token: string }

		return token
	}

	async function makeGitHubAuthoritative() {
		await db.insert(repositoryExternalSources).values({
			repositoryId,
			provider: 'github',
			externalRepositoryId: 4242n,
			ownerLogin: 'tessera-org',
			name: 'notes',
			fullName: 'tessera-org/notes',
			sourceUrl: 'https://github.com/tessera-org/notes',
			sourceDefaultBranch: 'main',
			mirrorMode: 'github_to_tessera',
			syncStatus: 'succeeded',
		})
	}

	async function listProviders() {
		const response = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/status-providers',
			{ headers: administrator.headers }
		)

		if (response.status !== 200)
			throw new Error(`Failed to list status providers: ${response.status}`)

		return await response.json()
	}

	async function revokeCredential(credentialId: string) {
		const response = await adapter.hono.request(
			`http://localhost/repositories/owner/notes/status-providers/credentials/${credentialId}`,
			{ method: 'DELETE', headers: administrator.headers }
		)

		if (response.status !== 200)
			throw new Error(`Failed to revoke credential: ${response.status}`)
	}

	/**
	 * A status the GitHub synchronizer would have projected: same context, no
	 * provider of its own, and the mapping that makes it read as GitHub's result
	 * rather than as an unattributed one. Written directly because this suite is
	 * about the native write path, not about re-proving the import.
	 */
	async function recordImportedStatus(
		context: string,
		state: 'failure' | 'stale',
		sha = HEAD_SHA
	) {
		const [check] = await db
			.insert(checks)
			.values({ repositoryId, sha, kind: 'status', context })
			.returning({ id: checks.id })

		if (!check) throw new Error('Failed to record an imported status')

		const [observation] = await db
			.insert(checkObservations)
			.values({
				repositoryId,
				checkId: check.id,
				state,
				fingerprint: `status:imported-${context}-${sha}`,
			})
			.returning({ id: checkObservations.id })

		if (!observation)
			throw new Error('Failed to record an imported observation')

		await db.insert(gitHubCommitStatusMappings).values({
			repositoryId,
			checkId: check.id,
			checkObservationId: observation.id,
			externalNodeId: `status-node-${context}-${sha}`,
			externalNumericId: BigInt(importedStatusCounter++),
			sha,
			context,
			rawState: state,
		})
	}

	/**
	 * A provider-backed result in a state no publisher may report. `stale` is a
	 * verdict only the ledger's owner reaches about a result it already holds, so
	 * the write API rightly rejects it and the enforcement proof needs the row
	 * placed directly.
	 */
	async function recordProviderStatus(context: string, state: 'stale') {
		const [provider] = await db
			.select({ id: checkStatusProviders.id })
			.from(checkStatusProviders)
			.limit(1)

		if (!provider)
			throw new Error('No status provider to attribute a result to')

		const [check] = await db
			.insert(checks)
			.values({
				repositoryId,
				sha: currentHeadSha,
				kind: 'status',
				context,
				providerId: provider.id,
			})
			.returning({ id: checks.id })

		if (!check) throw new Error('Failed to record a provider status')

		await db.insert(checkObservations).values({
			repositoryId,
			checkId: check.id,
			state,
			fingerprint: `published:direct-${context}-${state}`,
		})
	}

	async function listChecks(expectedHeadSha: string): Promise<ChecksListBody> {
		const response = await adapter.hono.request(
			`http://localhost/repositories/owner/notes/pulls/1/checks?${new URLSearchParams(
				{ expectedHeadSha }
			)}`,
			{ headers: owner.headers }
		)

		if (response.status !== 200)
			throw new Error(`Failed to list checks: ${response.status}`)

		return (await response.json()) as ChecksListBody
	}

	async function readMergeRequirements(): Promise<MergeRequirementsBody> {
		const response = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1/merge-requirements',
			{ headers: owner.headers }
		)

		if (response.status !== 200)
			throw new Error(`Failed to read merge requirements: ${response.status}`)

		return (await response.json()) as MergeRequirementsBody
	}

	async function attemptMerge() {
		const response = await request(
			'http://localhost/repositories/owner/notes/pulls/1/merge',
			'POST',
			owner.headers,
			{ expectedBaseSha: BASE_SHA, expectedHeadSha: currentHeadSha }
		)

		return (await response.json()) as { status: 'blocked' | 'merged' }
	}

	async function createRule(
		requiredCheckContexts: { context: string; kind?: string }[]
	) {
		const response = await request(
			'http://localhost/repositories/owner/notes/branch-protection',
			'PUT',
			administrator.headers,
			{ targetBranch: 'main', requiredCheckContexts }
		)

		if (response.status !== 200)
			throw new Error(`Failed to save protection rule: ${response.status}`)
	}

	async function createPullRequest() {
		const response = await request(
			'http://localhost/repositories/owner/notes/pulls',
			'POST',
			owner.headers,
			{ sourceBranch: 'feature', targetBranch: 'main', title: 'Add feature' }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create pull request: ${response.status}`)
	}

	async function countChecks(scopedRepositoryId: RepositoryId) {
		const rows = await db
			.select({ id: checks.id })
			.from(checks)
			.where(eq(checks.repositoryId, scopedRepositoryId))

		return rows.length
	}

	async function countObservations() {
		const rows = await db
			.select({ id: checkObservations.id })
			.from(checkObservations)
			.where(eq(checkObservations.repositoryId, repositoryId))

		return rows.length
	}

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

	async function createRepository(slug: string): Promise<RepositoryId> {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			owner.headers,
			{ name: slug, slug, visibility: 'private' }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)

		const { repository } = (await response.json()) as {
			repository: { id: RepositoryId }
		}

		return repository.id
	}

	function request(
		url: string,
		method: 'POST' | 'PUT',
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
		await db.delete(pullRequestEvents)
		await db.delete(mergeQueueEntries)
		await db.delete(repositoryMergeQueueStates)
		await db.delete(pullRequestMergeIntents)
		await db.delete(pullRequestComments)
		await db.delete(pullRequestThreads)
		await db.delete(pullRequestReviewerRequests)
		await db.delete(pullRequestReviews)
		await db.delete(pullRequests)
		await db.delete(repositoryPullRequestCounters)
		await db.delete(gitHubCommitStatusMappings)
		await db.delete(checkObservations)
		await db.delete(checks)
		await db.delete(checkStatusCredentials)
		await db.delete(checkStatusProviders)
		await db.delete(branchProtectionRules)
		await db.delete(repositoryEvents)
		await db.delete(repositoryCollaborators)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(apikey)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})
