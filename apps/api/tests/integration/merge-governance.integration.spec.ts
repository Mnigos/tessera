import { fileURLToPath } from 'node:url'
import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageClient, GitStorageModule } from '@config/git-storage'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { HonoAdapter } from '@mnigos/platform-hono'
import { AuthModule } from '@modules/auth'
import { BranchProtectionModule } from '@modules/branch-protection'
import { PullRequestsModule } from '@modules/pull-requests'
import { RepositoriesModule } from '@modules/repositories'
import { type INestApplication, Logger, Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { Test, type TestingModule } from '@nestjs/testing'
import type { CheckState } from '@repo/contracts'
import { eq } from '@repo/db'
import { db } from '@repo/db/client'
import {
	account,
	branchProtectionRules,
	checkObservations,
	checks,
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
/** The commit the source branch moves to, which ages every review out. */
const MOVED_HEAD_SHA = 'c'.repeat(40)
const MERGE_COMMIT_SHA = 'd'.repeat(40)

/**
 * The merge queue's own module is left out: it is the half of the queue that
 * needs Redis, and enforcement is decided entirely from the committed rows.
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
		PullRequestsModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
class MergeGovernanceIntegrationTestModule {}

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

interface BranchProtectionRuleBody {
	id: string
	targetBranch: string
	requiredApprovals: number
	requiredCheckContexts: { context: string; kind?: string }[]
	requireThreadsResolved: boolean
	dismissStaleApprovals: boolean
	bypass: { allowed: boolean; minimumRole?: string }
	version: number
}

interface MergeRequirementsBody {
	eligible: boolean
	evaluatedBaseSha?: string
	evaluatedHeadSha?: string
	rule?: { id: string; version: number; targetBranch: string }
	canBypass: boolean
	reasons: { code: string; [key: string]: unknown }[]
}

interface MergeResultBody {
	status: 'blocked' | 'merged'
	requirements?: MergeRequirementsBody
	pullRequest?: { state: string; mergeCommitSha?: string }
}

interface MergeAttemptOutcome extends MergeResultBody {
	httpStatus: number
	pullRequestState?: string
	mergeCalls: number
}

describe('Merge governance integration', () => {
	let moduleRef: TestingModule
	let app: INestApplication
	let adapter: HonoAdapter
	let listRepositoryRefs: ReturnType<typeof vi.fn>
	let compareRepositoryRefs: ReturnType<typeof vi.fn>
	let mergeRepositoryRefs: ReturnType<typeof vi.fn>
	let checkRepositoryMergeability: ReturnType<typeof vi.fn>
	let currentHeadSha: string
	let mergeable: boolean
	let owner: IntegrationUser
	let administrator: IntegrationUser
	let writer: IntegrationUser
	let reviewer: IntegrationUser
	let reader: IntegrationUser
	let outsider: IntegrationUser
	let repositoryId: RepositoryId

	beforeAll(async () => {
		vi.spyOn(Logger, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger, 'error').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })

		listRepositoryRefs = vi.fn(() =>
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
		)
		compareRepositoryRefs = vi.fn(() =>
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
		)
		mergeRepositoryRefs = vi.fn(() => Promise.resolve(MERGE_COMMIT_SHA))
		checkRepositoryMergeability = vi.fn(() =>
			Promise.resolve({
				baseSha: BASE_SHA,
				headSha: currentHeadSha,
				mergeBaseSha: BASE_SHA,
				mergeable,
				conflictPaths: mergeable ? [] : ['src/index.ts'],
				conflictPathsTruncated: false,
				conflictPathLimit: 100,
			})
		)

		moduleRef = await Test.createTestingModule({
			imports: [MergeGovernanceIntegrationTestModule],
		})
			.overrideProvider(GitStorageClient)
			.useValue({
				createRepository: vi.fn(({ repositoryId: id }) =>
					Promise.resolve({
						storagePath: `/var/lib/tessera/repositories/${id}.git`,
					})
				),
				listRepositoryRefs,
				compareRepositoryRefs,
				mergeRepositoryRefs,
				checkRepositoryMergeability,
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
		mergeable = true

		owner = await createIntegrationUser('owner')
		administrator = await createIntegrationUser('administrator')
		writer = await createIntegrationUser('writer')
		reviewer = await createIntegrationUser('reviewer')
		reader = await createIntegrationUser('reader')
		outsider = await createIntegrationUser('outsider')

		repositoryId = await createRepository()
		await addCollaborator(administrator, 'admin')
		await addCollaborator(writer, 'write')
		await addCollaborator(reviewer, 'write')
		await addCollaborator(reader, 'read')
	})

	afterAll(async () => {
		await resetIntegrationDatabase()
		await app.close()
		await moduleRef.close()
		vi.restoreAllMocks()
	})

	test('creates and updates a protection rule over HTTP while auditing both saves', async () => {
		const createResponse = await saveRule(administrator.headers, {
			targetBranch: 'main',
			requiredApprovals: 2,
			requiredCheckContexts: [
				{ context: 'build', kind: 'check_run' },
				{ context: 'build', kind: 'check_run' },
				{ context: 'audit' },
			],
			requireThreadsResolved: true,
			bypass: { allowed: true, minimumRole: 'admin' },
		})
		expect(createResponse.status).toBe(200)
		const created = (await createResponse.json()) as BranchProtectionRuleBody
		expect(created).toMatchObject({
			targetBranch: 'main',
			requiredApprovals: 2,
			// Canonicalized: the duplicate is dropped and the survivors are ordered.
			requiredCheckContexts: [
				{ context: 'audit' },
				{ context: 'build', kind: 'check_run' },
			],
			requireThreadsResolved: true,
			dismissStaleApprovals: true,
			bypass: { allowed: true, minimumRole: 'admin' },
			version: 1,
		})

		expect(
			await findRepositoryEvent('branch_protection_created')
		).toMatchObject({
			actorUserId: administrator.id,
			payload: {
				type: 'branch_protection_created',
				ruleId: created.id,
				targetBranch: 'main',
				current: { requiredApprovals: 2, version: 1 },
			},
		})

		const updateResponse = await saveRule(administrator.headers, {
			targetBranch: 'main',
			requiredApprovals: 1,
			dismissStaleApprovals: false,
			expectedVersion: 1,
		})
		expect(updateResponse.status).toBe(200)
		expect(await updateResponse.json()).toMatchObject({
			id: created.id,
			requiredApprovals: 1,
			requiredCheckContexts: [],
			dismissStaleApprovals: false,
			bypass: { allowed: false },
			version: 2,
		})
		expect(
			await findRepositoryEvent('branch_protection_updated')
		).toMatchObject({
			actorUserId: administrator.id,
			payload: {
				type: 'branch_protection_updated',
				previous: { requiredApprovals: 2, version: 1 },
				current: { requiredApprovals: 1, version: 2 },
			},
		})
	})

	test('rejects a save that presents a stale version and leaves the rule untouched', async () => {
		await saveRule(administrator.headers, {
			targetBranch: 'main',
			requiredApprovals: 1,
		})
		await saveRule(administrator.headers, {
			targetBranch: 'main',
			requiredApprovals: 2,
			expectedVersion: 1,
		})

		const response = await saveRule(administrator.headers, {
			targetBranch: 'main',
			requiredApprovals: 3,
			expectedVersion: 1,
		})
		const body = (await response.json()) as ErrorResponseBody

		expect(response.status).toBe(409)
		expect(body.code).toBe('CONFLICT')
		expect(
			await db.query.branchProtectionRules.findFirst({
				columns: { requiredApprovals: true, version: true },
			})
		).toEqual({ requiredApprovals: 2, version: 2 })
	})

	test('deletes a rule at its current version, audits it, and refuses a stale delete', async () => {
		const rule = await createRule({
			targetBranch: 'main',
			requiredApprovals: 1,
		})

		const staleResponse = await deleteRule(administrator.headers, rule.id, 99)
		expect(staleResponse.status).toBe(409)
		expect(await db.query.branchProtectionRules.findFirst()).toBeTruthy()

		const response = await deleteRule(
			administrator.headers,
			rule.id,
			rule.version
		)
		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ deleted: true })
		expect(await db.query.branchProtectionRules.findFirst()).toBeUndefined()
		expect(
			await findRepositoryEvent('branch_protection_deleted')
		).toMatchObject({
			actorUserId: administrator.id,
			payload: {
				type: 'branch_protection_deleted',
				ruleId: rule.id,
				previous: { targetBranch: 'main', requiredApprovals: 1 },
			},
		})
	})

	test('reports rules as unenforced while GitHub owns the repository', async () => {
		await createRule({ targetBranch: 'main', requiredApprovals: 1 })

		expect(await (await listRules(administrator.headers)).json()).toMatchObject(
			{
				rules: [{ targetBranch: 'main' }],
				enforced: true,
			}
		)

		await makeGitHubAuthoritative()

		expect(await (await listRules(administrator.headers)).json()).toMatchObject(
			{
				rules: [{ targetBranch: 'main' }],
				enforced: false,
			}
		)
	})

	test('forbids a write collaborator from reading or writing protection rules', async () => {
		const listResponse = await listRules(writer.headers)
		expect(listResponse.status).toBe(403)
		expect((await listResponse.json()) as ErrorResponseBody).toMatchObject({
			code: 'FORBIDDEN',
		})

		const saveResponse = await saveRule(writer.headers, {
			targetBranch: 'main',
			requiredApprovals: 0,
		})
		expect(saveResponse.status).toBe(403)
	})

	test('masks protection rules from a user who cannot see the repository', async () => {
		const listResponse = await listRules(outsider.headers)
		expect(listResponse.status).toBe(404)
		expect((await listResponse.json()) as ErrorResponseBody).toMatchObject({
			code: 'NOT_FOUND',
		})
		expect((await listRules()).status).toBe(401)
	})

	test('blocks a merge that lacks the required approvals and audits the attempt', async () => {
		const rule = await createRule({
			targetBranch: 'main',
			requiredApprovals: 2,
		})
		await createPullRequest()

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements).toMatchObject({
			eligible: false,
			canBypass: false,
			evaluatedBaseSha: BASE_SHA,
			evaluatedHeadSha: HEAD_SHA,
			rule: { id: rule.id, version: 1, targetBranch: 'main' },
			reasons: [
				{
					code: 'approvals_required',
					required: 2,
					approved: 0,
					staleApprovals: 0,
				},
			],
		})
		expect(await findPullRequestEvent('merge_blocked')).toMatchObject({
			actorUserId: writer.id,
			payload: {
				ruleId: rule.id,
				ruleVersion: 1,
				reasonCodes: ['approvals_required'],
				baseSha: BASE_SHA,
				headSha: HEAD_SHA,
			},
		})
	})

	test('discounts a stale approval only while the rule dismisses stale approvals', async () => {
		await createRule({
			targetBranch: 'main',
			requiredApprovals: 1,
			dismissStaleApprovals: true,
		})
		await createPullRequest()
		await submitReview(reviewer.headers, 'approve', HEAD_SHA)
		currentHeadSha = MOVED_HEAD_SHA

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})
		expect(outcome.requirements?.reasons).toEqual([
			{
				code: 'approvals_required',
				required: 1,
				approved: 0,
				staleApprovals: 1,
			},
		])

		await saveRule(administrator.headers, {
			targetBranch: 'main',
			requiredApprovals: 1,
			dismissStaleApprovals: false,
			expectedVersion: 1,
		})

		const merged = await mergePullRequest(writer.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: MOVED_HEAD_SHA,
		})
		expect(merged.status).toBe(200)
		expect((await merged.json()) as MergeResultBody).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: MERGE_COMMIT_SHA },
		})
	})

	test('keeps blocking on a change request after the head has moved past it', async () => {
		await createRule({ targetBranch: 'main', requiredApprovals: 0 })
		await createPullRequest()
		await submitReview(reviewer.headers, 'request_changes', HEAD_SHA)
		currentHeadSha = MOVED_HEAD_SHA

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements?.reasons).toMatchObject([
			{
				code: 'changes_requested',
				reviewers: [
					{
						outcome: 'request_changes',
						headSha: HEAD_SHA,
						stale: true,
					},
				],
			},
		])
	})

	test('separates pending required checks from failed and missing ones', async () => {
		await createRule({
			targetBranch: 'main',
			requiredCheckContexts: [
				{ context: 'build' },
				{ context: 'lint' },
				{ context: 'audit' },
			],
		})
		await createPullRequest()
		await recordCheck('build', 'pending')
		await recordCheck('lint', 'failure')

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements?.reasons).toMatchObject([
			{
				code: 'checks_failed',
				contexts: [
					{ requirement: { context: 'audit' }, state: 'missing' },
					{ requirement: { context: 'lint' }, state: 'failure' },
				],
			},
			{
				code: 'checks_pending',
				contexts: [{ requirement: { context: 'build' }, state: 'pending' }],
			},
		])
		expect(mergeRepositoryRefs).not.toHaveBeenCalled()
	})

	test('blocks on an unresolved thread while pending-only drafts stay invisible to policy', async () => {
		await createRule({ targetBranch: 'main', requireThreadsResolved: true })
		await createPullRequest()
		await createThread(reviewer.headers, 'Draft note', {
			expectedHeadSha: HEAD_SHA,
		})

		expect(await readMergeRequirements(writer.headers)).toMatchObject({
			eligible: true,
			reasons: [],
		})

		await submitReview(reviewer.headers, 'comment', HEAD_SHA)

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})
		expect(outcome.requirements?.reasons).toEqual([
			{ code: 'threads_unresolved', count: 1 },
		])
	})

	test('blocks a merge whose refs moved since the caller read them', async () => {
		await createPullRequest()
		currentHeadSha = MOVED_HEAD_SHA

		const outcome = await attemptMerge(writer.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
		})
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements?.reasons).toEqual([
			{
				code: 'stale_refs',
				expectedBaseSha: BASE_SHA,
				actualBaseSha: BASE_SHA,
				expectedHeadSha: HEAD_SHA,
				actualHeadSha: MOVED_HEAD_SHA,
			},
		])
	})

	test('blocks a merge Git reports as conflicting', async () => {
		await createPullRequest()
		mergeable = false

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements?.reasons).toEqual([
			{ code: 'merge_conflict', baseSha: BASE_SHA, headSha: HEAD_SHA },
		])
	})

	test('blocks a merge on a repository GitHub is authoritative for', async () => {
		await createPullRequest()
		await makeGitHubAuthoritative()

		const outcome = await attemptMerge(writer.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements).toMatchObject({
			eligible: false,
			canBypass: false,
			reasons: [{ code: 'read_only_mirror', authority: 'github' }],
		})
		// A refusal reached before evaluation resolves no refs and judges none.
		expect(outcome.requirements?.evaluatedBaseSha).toBeUndefined()
		expect(await findPullRequestEvent('merge_blocked')).toMatchObject({
			payload: { reasonCodes: ['read_only_mirror'] },
		})
	})

	test('blocks a merge from a collaborator without write access', async () => {
		await createPullRequest()

		const outcome = await attemptMerge(reader.headers)
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements?.reasons).toEqual([
			{
				code: 'insufficient_permission',
				requiredRole: 'write',
				actualRole: 'read',
			},
		])
		expect(await findPullRequestEvent('merge_blocked')).toMatchObject({
			actorUserId: reader.id,
			payload: { reasonCodes: ['insufficient_permission'] },
		})
	})

	test('merges past waivable blockers when an administrator supplies a reason', async () => {
		const rule = await createRule({
			targetBranch: 'main',
			requiredApprovals: 1,
			requireThreadsResolved: true,
			bypass: { allowed: true, minimumRole: 'admin' },
		})
		await createPullRequest()
		await createThread(administrator.headers, 'Unresolved question')

		const requirements = await readMergeRequirements(administrator.headers)
		expect(requirements).toMatchObject({
			eligible: false,
			canBypass: true,
			reasons: [
				{ code: 'approvals_required' },
				{ code: 'threads_unresolved', count: 1 },
			],
		})

		const response = await mergePullRequest(administrator.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
			bypass: { reason: 'Release hotfix, policy waived deliberately' },
		})
		expect(response.status).toBe(200)
		expect((await response.json()) as MergeResultBody).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: MERGE_COMMIT_SHA },
		})

		// The waiver explains the merge, so it is ordered ahead of it whatever the
		// two rows' shared timestamp says.
		expect(await listPullRequestEventTypes()).toEqual([
			'opened',
			'commented',
			'merge_bypassed',
			'merged',
		])
		expect(await findPullRequestEvent('merge_bypassed')).toMatchObject({
			actorUserId: administrator.id,
			payload: {
				ruleId: rule.id,
				ruleVersion: 1,
				reason: 'Release hotfix, policy waived deliberately',
				bypassedReasonCodes: ['approvals_required', 'threads_unresolved'],
				baseSha: BASE_SHA,
				headSha: HEAD_SHA,
			},
		})
	})

	test('refuses a bypass while a blocker no policy may waive is present', async () => {
		await createRule({
			targetBranch: 'main',
			requiredApprovals: 1,
			bypass: { allowed: true, minimumRole: 'admin' },
		})
		await createPullRequest()
		mergeable = false

		const outcome = await attemptMerge(administrator.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
			bypass: { reason: 'Merging anyway' },
		})
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements).toMatchObject({
			canBypass: false,
			reasons: [{ code: 'merge_conflict' }, { code: 'approvals_required' }],
		})
		expect(await findPullRequestEvent('merge_bypassed')).toBeUndefined()
	})

	test('refuses a bypass from a role the rule does not empower', async () => {
		await createRule({
			targetBranch: 'main',
			requiredApprovals: 1,
			bypass: { allowed: true, minimumRole: 'admin' },
		})
		await createPullRequest()

		const outcome = await attemptMerge(writer.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
			bypass: { reason: 'Let me through' },
		})
		expect(outcome).toMatchObject({
			httpStatus: 200,
			status: 'blocked',
			pullRequestState: 'open',
			mergeCalls: 0,
		})

		expect(outcome.requirements).toMatchObject({
			canBypass: false,
			reasons: [{ code: 'approvals_required' }],
		})
		expect(await findPullRequestEvent('merge_bypassed')).toBeUndefined()
	})

	test('rejects a bypass whose reason is blank', async () => {
		await createRule({
			targetBranch: 'main',
			requiredApprovals: 1,
			bypass: { allowed: true, minimumRole: 'admin' },
		})
		await createPullRequest()

		const response = await mergePullRequest(administrator.headers, {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: HEAD_SHA,
			bypass: { reason: '   ' },
		})

		expect(response.status).toBe(400)
		expect(mergeRepositoryRefs).not.toHaveBeenCalled()
	})

	test('answers the requirements read without auditing it, and never anonymously', async () => {
		await createRule({ targetBranch: 'main', requiredApprovals: 1 })
		await createPullRequest()

		expect((await getMergeRequirements()).status).toBe(401)

		const requirements = await readMergeRequirements(reader.headers)
		expect(requirements).toMatchObject({
			eligible: false,
			canBypass: false,
			reasons: [
				{ code: 'insufficient_permission' },
				{ code: 'approvals_required' },
			],
		})
		expect(await findPullRequestEvent('merge_blocked')).toBeUndefined()
	})

	/**
	 * A merge attempt and what it left behind, so a test can state the verdict,
	 * the pull request's fate and whether Git was ever asked in one assertion.
	 */
	async function attemptMerge(
		headers: Headers,
		input: object = {
			expectedBaseSha: BASE_SHA,
			expectedHeadSha: currentHeadSha,
		}
	): Promise<MergeAttemptOutcome> {
		const response = await mergePullRequest(headers, input)
		const body = (await response.json()) as MergeResultBody
		const pullRequest = await db.query.pullRequests.findFirst({
			columns: { state: true },
		})

		return {
			...body,
			httpStatus: response.status,
			pullRequestState: pullRequest?.state,
			mergeCalls: mergeRepositoryRefs.mock.calls.length,
		}
	}

	async function readMergeRequirements(
		headers: Headers
	): Promise<MergeRequirementsBody> {
		const response = await getMergeRequirements(headers)

		if (response.status !== 200)
			throw new Error(`Failed to read merge requirements: ${response.status}`)

		return (await response.json()) as MergeRequirementsBody
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

	async function createRepository(): Promise<RepositoryId> {
		const response = await request(
			'http://localhost/repositories',
			'POST',
			owner.headers,
			{ name: 'Notes', slug: 'notes', visibility: 'private' }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create repository: ${response.status}`)

		const repository = await db.query.repositories.findFirst({
			columns: { id: true },
		})

		if (!repository) throw new Error('Failed to find the created repository')

		return repository.id
	}

	async function addCollaborator(
		collaborator: IntegrationUser,
		role: 'admin' | 'read' | 'write'
	) {
		await db
			.insert(repositoryCollaborators)
			.values({ repositoryId, userId: collaborator.id, role })
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

	async function createRule(input: object): Promise<BranchProtectionRuleBody> {
		const response = await saveRule(administrator.headers, input)

		if (response.status !== 200)
			throw new Error(`Failed to save protection rule: ${response.status}`)

		return (await response.json()) as BranchProtectionRuleBody
	}

	async function recordCheck(context: string, state: CheckState) {
		const [check] = await db
			.insert(checks)
			.values({ repositoryId, sha: currentHeadSha, kind: 'check_run', context })
			.returning({ id: checks.id })

		if (!check) throw new Error('Failed to record a check')

		await db.insert(checkObservations).values({
			repositoryId,
			checkId: check.id,
			state,
			fingerprint: `${context}:${state}`,
		})
	}

	async function submitReview(
		headers: Headers,
		outcome: 'approve' | 'comment' | 'request_changes',
		expectedHeadSha: string
	) {
		const response = await request(
			'http://localhost/repositories/owner/notes/pulls/1/reviews',
			'POST',
			headers,
			{ outcome, expectedHeadSha }
		)

		if (response.status !== 200)
			throw new Error(`Failed to submit review: ${response.status}`)
	}

	async function createThread(
		headers: Headers,
		body: string,
		review?: { expectedHeadSha: string }
	) {
		const response = await request(
			'http://localhost/repositories/owner/notes/pulls/1/threads',
			'POST',
			headers,
			{ body, review }
		)

		if (response.status !== 200)
			throw new Error(`Failed to create thread: ${response.status}`)
	}

	function listRules(headers?: Headers) {
		return adapter.hono.request(
			'http://localhost/repositories/owner/notes/branch-protection',
			{ headers }
		)
	}

	function saveRule(headers: Headers, input: object) {
		return request(
			'http://localhost/repositories/owner/notes/branch-protection',
			'PUT',
			headers,
			input
		)
	}

	function deleteRule(
		headers: Headers,
		ruleId: string,
		expectedVersion: number
	) {
		const requestHeaders = new Headers(headers)
		requestHeaders.set('content-type', 'application/json')

		return adapter.hono.request(
			`http://localhost/repositories/owner/notes/branch-protection/${ruleId}`,
			{
				method: 'DELETE',
				headers: requestHeaders,
				body: JSON.stringify({ expectedVersion }),
			}
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

	function getMergeRequirements(headers?: Headers) {
		return adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1/merge-requirements',
			{ headers }
		)
	}

	async function findRepositoryEvent(type: string) {
		return await db.query.repositoryEvents.findFirst({
			where: eq(repositoryEvents.type, type as 'branch_protection_created'),
		})
	}

	async function findPullRequestEvent(type: string) {
		return await db.query.pullRequestEvents.findFirst({
			where: eq(pullRequestEvents.type, type as 'merge_blocked'),
		})
	}

	async function listPullRequestEventTypes(): Promise<string[]> {
		const response = await adapter.hono.request(
			'http://localhost/repositories/owner/notes/pulls/1',
			{ headers: owner.headers }
		)
		const body = (await response.json()) as { events: { type: string }[] }

		return body.events.map(event => event.type)
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
		await db.delete(checkObservations)
		await db.delete(checks)
		await db.delete(branchProtectionRules)
		await db.delete(repositoryEvents)
		await db.delete(repositoryCollaborators)
		await db.delete(repositoryExternalSources)
		await db.delete(repositories)
		await db.delete(session)
		await db.delete(account)
		await db.delete(user)
	}
})
