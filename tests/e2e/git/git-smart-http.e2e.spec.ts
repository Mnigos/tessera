import { db } from '@repo/db/client'
import { pullRequestEvents, repositoryExternalSources } from '@repo/db/schema'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { $, file, sleep } from 'bun'
import { asc, eq } from 'drizzle-orm'
import {
	comparePullRequest,
	createGitAccessToken,
	createPullRequest,
	createRepository,
	createSshPublicKey,
	createTestSessionHeaders,
	getBlobPreview,
	getBrowserSummary,
	getPullRequest,
	joinMergeQueue,
	mergePullRequest,
	mergePullRequestWithRefs,
} from './helpers/api'
import { migrateGitE2EDatabase, resetGitE2EDatabase } from './helpers/database'
import {
	checkoutBranch,
	cloneRepository,
	cloneRepositoryOverSsh,
	commitAndPushBranch,
	createAndPushBranch,
	createCommittedRepository,
	fetchRepository,
	fetchRepositoryOverSsh,
	gitOutput,
	lsRemote,
	pushRepository,
	pushRepositoryOverSsh,
	rewriteAndForcePushBranchOverSsh,
	smartHttpUrl,
	sshUrl,
} from './helpers/git-cli'
import { getGitE2EPortReservations } from './helpers/ports'
import { startGitE2EProcesses, stopGitE2EProcesses } from './helpers/processes'

interface GitE2EPorts {
	apiGrpc: number
	apiHttp: number
	gitGrpc: number
	gitHttp: number
	gitSsh: number
}

type GitE2EProcesses = Awaited<ReturnType<typeof startGitE2EProcesses>>

const GITHUB_SOURCE_OF_TRUTH_MESSAGE =
	'GitHub is the source of truth for this repository. Make this change on GitHub.'

describe('Git smart HTTP e2e', () => {
	let ports: GitE2EPorts
	let processes: GitE2EProcesses | undefined
	let runDirectory: string
	let storageRoot: string
	let apiBaseUrl: string

	beforeAll(async () => {
		await migrateGitE2EDatabase()
		await resetGitE2EDatabase()

		const portReservations = getGitE2EPortReservations()
		const [apiHttp, apiGrpc, gitGrpc, gitHttp, gitSsh] = portReservations.ports
		ports = { apiGrpc, apiHttp, gitGrpc, gitHttp, gitSsh }
		runDirectory = `/tmp/tessera-git-e2e-${crypto.randomUUID()}`
		await $`mkdir -p ${runDirectory}`.quiet()
		storageRoot = `${runDirectory}/git-storage`
		apiBaseUrl = `http://localhost:${apiHttp}`
		processes = await startGitE2EProcesses({
			ports,
			releasePortReservations: portReservations.release,
			storageRoot,
		})
	})

	beforeEach(async () => {
		await resetGitE2EDatabase()
	})

	afterAll(async () => {
		await resetGitE2EDatabase()
		await stopGitE2EProcesses(processes, runDirectory)
	})

	test('lets the owner push with a write token and read the pushed blob through the API', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'marta@example.com',
			username: 'marta',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'Notes',
			slug: 'notes',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:write'],
		})
		const localRepository = `${runDirectory}/owner-push`

		await createCommittedRepository(
			localRepository,
			'README.md',
			'# Tessera E2E\n'
		)

		const pushResult = await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'marta', repository.slug, token)
		)
		const preview = await getBlobPreview(
			apiBaseUrl,
			'marta',
			repository.slug,
			'README.md',
			headers
		)

		expect(pushResult.exitCode).toBe(0)
		expect(preview).toMatchObject({
			type: 'text',
			content: '# Tessera E2E\n',
		})
	})

	test('allows anonymous clones of public repositories after an initial push', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'marta-public@example.com',
			username: 'marta-public',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'Public Notes',
			slug: 'public-notes',
			visibility: 'public',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:read', 'git:write'],
		})
		const localRepository = `${runDirectory}/public-source`
		const cloneDirectory = `${runDirectory}/public-clone`

		await createCommittedRepository(localRepository, 'README.md', '# Public\n')
		const pushResult = await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'marta-public', repository.slug, token)
		)
		expect(pushResult.exitCode).toBe(0)

		const cloneResult = await cloneRepository(
			smartHttpUrl(ports.gitHttp, 'marta-public', repository.slug),
			cloneDirectory
		)
		const fetchResult = await fetchRepository(cloneDirectory)

		expect(cloneResult.exitCode).toBe(0)
		expect(fetchResult.exitCode, fetchResult.stderr).toBe(0)
	})

	test('merges a pull request into a real Git two-parent commit through the API', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'pull-request@example.com',
			name: 'Pull Request Owner',
			username: 'pull-request-owner',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'Pull Request Repository',
			slug: 'pull-request-repository',
			visibility: 'public',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:read', 'git:write'],
		})
		const localRepository = `${runDirectory}/pull-request-merge`
		await createCommittedRepository(localRepository, 'README.md', '# Base\n')
		await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'pull-request-owner', repository.slug, token)
		)
		const baseSha = await gitOutput(localRepository, ['rev-parse', 'main'])
		await createAndPushBranch(
			localRepository,
			'feature',
			'feature.txt',
			'feature\n'
		)
		const headSha = await gitOutput(localRepository, ['rev-parse', 'feature'])
		const pullRequest = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			username: 'pull-request-owner',
		})

		const merged = await mergePullRequest({
			apiBaseUrl,
			headers,
			number: pullRequest.number,
			slug: repository.slug,
			username: 'pull-request-owner',
		})
		const mergedComparison = await comparePullRequest({
			apiBaseUrl,
			headers,
			number: pullRequest.number,
			slug: repository.slug,
			username: 'pull-request-owner',
		})
		await gitOutput(localRepository, [
			'remote',
			'set-url',
			'origin',
			smartHttpUrl(ports.gitHttp, 'pull-request-owner', repository.slug),
		])
		const fetchResult = await fetchRepository(localRepository)
		expect(fetchResult.exitCode, fetchResult.stderr).toBe(0)
		const remoteMainRef = await gitOutput(localRepository, [
			'ls-remote',
			'origin',
			'refs/heads/main',
		])
		const remoteMainSha = remoteMainRef.split('\t')[0]
		if (!remoteMainSha) throw new Error('remote main ref was not returned')
		const parents = await gitOutput(localRepository, [
			'show',
			'-s',
			'--format=%P',
			remoteMainSha,
		])
		const author = await gitOutput(localRepository, [
			'show',
			'-s',
			'--format=%an <%ae>',
			remoteMainSha,
		])

		expect(merged).toMatchObject({
			status: 'merged',
			pullRequest: { state: 'merged', mergeCommitSha: remoteMainSha },
		})
		expect(parents.split(' ')).toEqual([baseSha, headSha])
		expect(author).toBe('Pull Request Owner <pull-request@example.com>')
		expect(mergedComparison).toMatchObject({
			commits: [{ sha: headSha }],
			files: [{ newPath: 'feature.txt' }],
		})
	})

	/**
	 * One repository with a pull request ready to merge, so each strategy's test
	 * says only what is different about that strategy.
	 */
	async function createMergeFixture({
		conflicting = false,
		divergeTarget = true,
		slug,
		username,
	}: {
		/** Both branches change the same lines, so no method can combine them. */
		conflicting?: boolean
		divergeTarget?: boolean
		slug: string
		username: string
	}) {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: `${username}@example.com`,
			name: 'Pull Request Owner',
			username,
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: slug,
			slug,
			visibility: 'public',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:read', 'git:write'],
		})
		const localRepository = `${runDirectory}/${slug}`
		await createCommittedRepository(localRepository, 'README.md', '# Base\n')
		await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, username, repository.slug, token)
		)
		await createAndPushBranch(
			localRepository,
			'feature',
			conflicting ? 'README.md' : 'first.txt',
			conflicting ? '# From the source\n' : 'first\n'
		)
		await commitAndPushBranch(
			localRepository,
			'feature',
			'second.txt',
			'second\n'
		)
		const headSha = await gitOutput(localRepository, ['rev-parse', 'feature'])

		if (divergeTarget) {
			await checkoutBranch(localRepository, 'main')
			await commitAndPushBranch(
				localRepository,
				'main',
				conflicting ? 'README.md' : 'target.txt',
				conflicting ? '# From the target\n' : 'target\n'
			)
		}

		const baseSha = await gitOutput(localRepository, ['rev-parse', 'main'])
		const pullRequest = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			username,
		})
		await gitOutput(localRepository, [
			'remote',
			'set-url',
			'origin',
			smartHttpUrl(ports.gitHttp, username, repository.slug),
		])

		return {
			baseSha,
			headSha,
			headers,
			localRepository,
			number: pullRequest.number,
			slug: repository.slug,
			/** Deleting the source branch is a write, so it needs the token URL. */
			writableUrl: smartHttpUrl(
				ports.gitHttp,
				username,
				repository.slug,
				token
			),
			username,
		}
	}

	/**
	 * Drops the source branch, which is what a merged pull request's comparison
	 * has to survive: only the operation receipt still reaches the commits it was
	 * merged from.
	 */
	async function deleteSourceBranch(fixture: {
		localRepository: string
		writableUrl: string
	}) {
		await gitOutput(fixture.localRepository, [
			'push',
			fixture.writableUrl,
			'--delete',
			'feature',
		])
	}

	/**
	 * The queue merges on a worker of its own, so the pull request is polled
	 * rather than waited on for a fixed span that a slow run would outlast.
	 */
	async function waitForMergedPullRequest(fixture: {
		headers: Headers
		number: number
		slug: string
		username: string
	}) {
		const deadline = Date.now() + 30_000
		let latest = await getPullRequest({ apiBaseUrl, ...fixture })

		while (latest.pullRequest.state !== 'merged' && Date.now() < deadline) {
			await sleep(500)
			latest = await getPullRequest({ apiBaseUrl, ...fixture })
		}

		return latest
	}

	/** The target branch as the server actually left it, read back over Git. */
	async function readRemoteTarget(localRepository: string) {
		const fetchResult = await fetchRepository(localRepository)

		if (fetchResult.exitCode !== 0)
			throw new Error(
				`Failed to fetch the merged target: ${fetchResult.stderr}`
			)

		const remoteMainRef = await gitOutput(localRepository, [
			'ls-remote',
			'origin',
			'refs/heads/main',
		])
		const sha = remoteMainRef.split('\t')[0]
		if (!sha) throw new Error('remote main ref was not returned')

		return sha
	}

	// A squash leaves one commit with one parent, and its tree is the merge's
	// rather than the source head's, so work already on the target survives.
	test('squashes a pull request into one real commit', async () => {
		const fixture = await createMergeFixture({
			slug: 'squash-repository',
			username: 'squash-owner',
		})

		const merged = await mergePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: {
				strategy: 'squash',
				squashTitle: 'Everything at once (#1)',
				squashBody: 'Why it changed',
			},
			slug: fixture.slug,
			username: fixture.username,
		})
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)
		const parents = await gitOutput(fixture.localRepository, [
			'show',
			'-s',
			'--format=%P',
			remoteMainSha,
		])
		const message = await gitOutput(fixture.localRepository, [
			'show',
			'-s',
			'--format=%B',
			remoteMainSha,
		])
		const files = await gitOutput(fixture.localRepository, [
			'ls-tree',
			'--name-only',
			remoteMainSha,
		])

		expect(merged).toMatchObject({
			status: 'merged',
			pullRequest: {
				state: 'merged',
				mergeCommitSha: remoteMainSha,
				mergeStrategy: 'squash',
			},
		})
		expect(parents.split(' ')).toEqual([fixture.baseSha])
		expect(message).toContain('Everything at once (#1)')
		expect(message).toContain('Why it changed')
		expect(files.split('\n')).toContain('target.txt')

		// The source branch is gone, and only the operation receipt still reaches
		// the commits the merged comparison is read from.
		await deleteSourceBranch(fixture)
		const mergedComparison = await comparePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			slug: fixture.slug,
			username: fixture.username,
		})

		expect(mergedComparison.commits).toHaveLength(2)
		expect(mergedComparison.files.map(({ newPath }) => newPath)).toEqual(
			expect.arrayContaining(['first.txt', 'second.txt'])
		)
	})

	// A rebase leaves the author's commits, rewritten onto the target in order,
	// with whoever merged recorded as the committer.
	test('rebases a pull request into a real linear chain', async () => {
		const fixture = await createMergeFixture({
			slug: 'rebase-repository',
			username: 'rebase-owner',
		})

		const merged = await mergePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy: 'rebase' },
			slug: fixture.slug,
			username: fixture.username,
		})
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)
		const replayed = await gitOutput(fixture.localRepository, [
			'log',
			'--reverse',
			'--format=%s%x00%an%x00%cn',
			`${fixture.baseSha}..${remoteMainSha}`,
		])
		const rows = replayed.split('\n').map(row => row.split('\0'))

		expect(merged).toMatchObject({
			status: 'merged',
			pullRequest: { mergeStrategy: 'rebase', mergeCommitSha: remoteMainSha },
		})
		expect(rows).toHaveLength(2)
		expect(rows[0]?.[0]).toBe('Add first.txt')
		expect(rows[1]?.[0]).toBe('Add second.txt')
		// Both were replayed, so neither is the original commit any more.
		expect(remoteMainSha).not.toBe(fixture.headSha)
		expect(rows.every(row => row[2] === 'Pull Request Owner')).toBeTruthy()

		await deleteSourceBranch(fixture)
		const mergedComparison = await comparePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			slug: fixture.slug,
			username: fixture.username,
		})

		expect(mergedComparison.commits).toHaveLength(2)
	})

	// A fast-forward writes no commit at all: the target is moved onto the source
	// head, which is only possible while the two have not diverged.
	test('fast-forwards a pull request onto the source head', async () => {
		const fixture = await createMergeFixture({
			divergeTarget: false,
			slug: 'fast-forward-repository',
			username: 'fast-forward-owner',
		})

		const merged = await mergePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy: 'fast_forward' },
			slug: fixture.slug,
			username: fixture.username,
		})
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)

		expect(remoteMainSha).toBe(fixture.headSha)
		expect(merged).toMatchObject({
			status: 'merged',
			pullRequest: {
				mergeStrategy: 'fast_forward',
				mergeCommitSha: fixture.headSha,
			},
		})
	})

	// A conflict is a fact about the files, so every method that combines the two
	// tips refuses it — against a real repository, not a mocked answer — and none
	// of them moves the target.
	test.each([
		'merge_commit',
		'squash',
		'rebase',
	] as const)('refuses a conflicting %s and leaves the target where it was', async strategy => {
		const slug = `conflict-${strategy.replaceAll('_', '-')}-repository`
		const username = `conflict-${strategy.replaceAll('_', '-')}-owner`
		const fixture = await createMergeFixture({
			conflicting: true,
			slug,
			username,
		})

		const refused = await mergePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy },
			slug: fixture.slug,
			username: fixture.username,
		})
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)

		expect(refused.status).toBe('blocked')
		expect(remoteMainSha).toBe(fixture.baseSha)
	})

	// The requirements say what each method could do, and the merge refuses the
	// one that cannot run rather than silently substituting another.
	test('refuses a fast-forward of branches that have diverged', async () => {
		const fixture = await createMergeFixture({
			slug: 'diverged-repository',
			username: 'diverged-owner',
		})

		const refused = await mergePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy: 'fast_forward' },
			slug: fixture.slug,
			username: fixture.username,
		})
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)

		expect(refused).toMatchObject({
			status: 'blocked',
			requirements: {
				reasons: [
					{
						code: 'merge_strategy_unavailable',
						strategy: 'fast_forward',
						reason: 'not_fast_forward',
					},
				],
			},
		})
		expect(remoteMainSha).toBe(fixture.baseSha)
	})

	// Git has the last word on freshness, and a refused merge leaves the target
	// exactly where it was — no strategy is an exception to that.
	test.each([
		'merge_commit',
		'squash',
		'rebase',
		'fast_forward',
	] as const)('refuses a stale %s and leaves the target where it was', async strategy => {
		const fixture = await createMergeFixture({
			slug: `stale-${strategy.replaceAll('_', '-')}-repository`,
			username: `stale-${strategy.replaceAll('_', '-')}-owner`,
		})

		const refused = await mergePullRequestWithRefs({
			apiBaseUrl,
			expectedBaseSha: '0'.repeat(40),
			expectedHeadSha: fixture.headSha,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy },
			slug: fixture.slug,
			username: fixture.username,
		})
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)

		expect(refused.status).toBe('blocked')
		expect(remoteMainSha).toBe(fixture.baseSha)
	})

	// The method is settled when the entry is created, and the run that merges it
	// uses that method rather than re-choosing one.
	test('merges a queued pull request by the method it was queued with', async () => {
		const fixture = await createMergeFixture({
			slug: 'queued-strategy-repository',
			username: 'queued-strategy-owner',
		})

		const status = await joinMergeQueue({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy: 'squash', squashTitle: 'Queued squash (#1)' },
			slug: fixture.slug,
			username: fixture.username,
		})

		expect(status.entry).toMatchObject({ strategy: 'squash' })

		const merged = await waitForMergedPullRequest(fixture)
		const remoteMainSha = await readRemoteTarget(fixture.localRepository)
		const message = await gitOutput(fixture.localRepository, [
			'show',
			'-s',
			'--format=%B',
			remoteMainSha,
		])

		expect(merged.pullRequest).toMatchObject({
			state: 'merged',
			mergeStrategy: 'squash',
		})
		expect(message).toContain('Queued squash (#1)')
	})

	// Tessera keeps its operation receipts in a namespace Git transport never
	// shows and never accepts writes into.
	test('never advertises or accepts writes to the operation receipts', async () => {
		const fixture = await createMergeFixture({
			slug: 'hidden-refs-repository',
			username: 'hidden-refs-owner',
		})
		await mergePullRequest({
			apiBaseUrl,
			headers: fixture.headers,
			number: fixture.number,
			selection: { strategy: 'squash' },
			slug: fixture.slug,
			username: fixture.username,
		})

		const advertised = await lsRemote(
			smartHttpUrl(ports.gitHttp, fixture.username, fixture.slug)
		)
		const forcedPush =
			await $`git push origin HEAD:refs/tessera/operations/018f6f4a-11d3-7c8b-9c5e-5cf1d2e3a4c7`
				.cwd(fixture.localRepository)
				.nothrow()
				.quiet()

		expect(advertised.stdout).toContain('refs/heads/main')
		expect(advertised.stdout).not.toContain('refs/tessera')
		expect(forcedPush.exitCode).not.toBe(0)
	})

	test('lets the owner push, clone, and fetch repositories over SSH', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'ssh-owner@example.com',
			username: 'ssh-owner',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'SSH Notes',
			slug: 'ssh-notes',
		})
		const key = await createSshKeyPair('ssh-owner')
		await createSshPublicKey({
			apiBaseUrl,
			headers,
			publicKey: key.publicKey,
			title: 'E2E SSH key',
		})
		const localRepository = `${runDirectory}/ssh-owner-push`
		const cloneDirectory = `${runDirectory}/ssh-owner-clone`
		const remoteUrl = sshUrl(ports.gitSsh, 'ssh-owner', repository.slug)

		await createCommittedRepository(localRepository, 'README.md', '# SSH E2E\n')
		const pushResult = await pushRepositoryOverSsh(
			localRepository,
			remoteUrl,
			key.privateKeyPath
		)
		const cloneResult = await cloneRepositoryOverSsh(
			remoteUrl,
			cloneDirectory,
			key.privateKeyPath
		)
		expect(cloneResult.exitCode, cloneResult.stderr).toBe(0)
		const fetchResult = await fetchRepositoryOverSsh(
			cloneDirectory,
			key.privateKeyPath
		)
		const preview = await getBlobPreview(
			apiBaseUrl,
			'ssh-owner',
			repository.slug,
			'README.md',
			headers
		)

		expect(pushResult.exitCode, pushResult.stderr).toBe(0)
		expect(fetchResult.exitCode, fetchResult.stderr).toBe(0)
		expect(preview).toMatchObject({
			type: 'text',
			content: '# SSH E2E\n',
		})
	})

	test('writes a head update on every open pull request a fast-forwarded branch backs', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'push-events@example.com',
			username: 'push-events',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'Push Events',
			slug: 'push-events',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:read', 'git:write'],
		})
		const localRepository = `${runDirectory}/push-events-http`
		await createCommittedRepository(localRepository, 'README.md', '# Base\n')
		await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'push-events', repository.slug, token)
		)
		await createAndPushBranch(
			localRepository,
			'release',
			'release.txt',
			'release\n'
		)
		await checkoutBranch(localRepository, 'main')
		await createAndPushBranch(
			localRepository,
			'feature',
			'feature.txt',
			'feature\n'
		)
		const openedHeadSha = await gitOutput(localRepository, [
			'rev-parse',
			'feature',
		])
		const toMain = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			username: 'push-events',
		})
		const toRelease = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			targetBranch: 'release',
			title: 'Merge feature into release',
			username: 'push-events',
		})

		const pushResult = await commitAndPushBranch(
			localRepository,
			'feature',
			'more.txt',
			'more\n'
		)
		const pushedHeadSha = await gitOutput(localRepository, [
			'rev-parse',
			'feature',
		])

		expect(pushResult.exitCode, pushResult.stderr).toBe(0)
		for (const pullRequest of [toMain, toRelease]) {
			const events = await waitForPullRequestPushEvents(pullRequest.id)

			expect(events).toMatchObject([
				{
					type: 'head_updated',
					provider: 'tessera',
					actorUserId: pullRequest.authorUserId,
					payload: {
						ref: 'refs/heads/feature',
						oldSha: openedHeadSha,
						newSha: pushedHeadSha,
					},
				},
			])
		}
	})

	test('writes a force push on every open pull request a rewritten branch backs', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'force-push@example.com',
			username: 'force-push',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'Force Push',
			slug: 'force-push',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:read', 'git:write'],
		})
		const key = await createSshKeyPair('force-push')
		await createSshPublicKey({
			apiBaseUrl,
			headers,
			publicKey: key.publicKey,
			title: 'E2E SSH key',
		})
		const localRepository = `${runDirectory}/push-events-ssh`
		await createCommittedRepository(localRepository, 'README.md', '# Base\n')
		await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'force-push', repository.slug, token)
		)
		await createAndPushBranch(
			localRepository,
			'release',
			'release.txt',
			'release\n'
		)
		await checkoutBranch(localRepository, 'main')
		await createAndPushBranch(
			localRepository,
			'feature',
			'feature.txt',
			'feature\n'
		)
		const openedHeadSha = await gitOutput(localRepository, [
			'rev-parse',
			'feature',
		])
		const toMain = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			username: 'force-push',
		})
		const toRelease = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			targetBranch: 'release',
			title: 'Merge feature into release',
			username: 'force-push',
		})
		await pushRepositoryOverSsh(
			localRepository,
			sshUrl(ports.gitSsh, 'force-push', repository.slug),
			key.privateKeyPath
		)

		const pushResult = await rewriteAndForcePushBranchOverSsh(
			localRepository,
			'feature',
			'rewritten.txt',
			'rewritten\n',
			key.privateKeyPath
		)
		const rewrittenHeadSha = await gitOutput(localRepository, [
			'rev-parse',
			'feature',
		])

		expect(pushResult.exitCode, pushResult.stderr).toBe(0)
		for (const pullRequest of [toMain, toRelease]) {
			const events = await waitForPullRequestPushEvents(pullRequest.id)

			expect(events).toMatchObject([
				{
					type: 'force_pushed',
					actorUserId: pullRequest.authorUserId,
					payload: {
						ref: 'refs/heads/feature',
						oldSha: openedHeadSha,
						newSha: rewrittenHeadSha,
					},
				},
			])
		}
	})

	test('writes no push event for a branch created before its pull request or for an API merge', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'no-push-events@example.com',
			username: 'no-push-events',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'No Push Events',
			slug: 'no-push-events',
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:read', 'git:write'],
		})
		const localRepository = `${runDirectory}/no-push-events`
		await createCommittedRepository(localRepository, 'README.md', '# Base\n')
		await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'no-push-events', repository.slug, token)
		)
		await createAndPushBranch(
			localRepository,
			'feature',
			'feature.txt',
			'feature\n'
		)
		const pullRequest = await createPullRequest({
			apiBaseUrl,
			headers,
			slug: repository.slug,
			username: 'no-push-events',
		})

		await mergePullRequest({
			apiBaseUrl,
			headers,
			number: pullRequest.number,
			slug: repository.slug,
			username: 'no-push-events',
		})

		expect(await listPullRequestPushEvents(pullRequest.id)).toEqual([])
	})

	test('rejects HTTP pushes to GitHub mirrored repositories without breaking fetches', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'http-mirror@example.com',
			username: 'http-mirror',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'HTTP Mirror',
			slug: 'http-mirror',
			visibility: 'public',
		})
		await createGitHubMirroredExternalSource({
			externalRepositoryId: 3_701n,
			fullName: 'http-mirror/http-mirror',
			name: 'http-mirror',
			ownerLogin: 'http-mirror',
			repositoryId: repository.id,
		})
		const token = await createGitAccessToken({
			apiBaseUrl,
			headers,
			permissions: ['git:write'],
		})
		const localRepository = `${runDirectory}/http-mirror-push`

		await createCommittedRepository(localRepository, 'README.md', '# Mirror\n')
		const pushResult = await pushRepository(
			localRepository,
			smartHttpUrl(ports.gitHttp, 'http-mirror', repository.slug, token)
		)
		const lsResult = await lsRemote(
			smartHttpUrl(ports.gitHttp, 'http-mirror', repository.slug)
		)

		expect(pushResult.exitCode).not.toBe(0)
		expect(`${pushResult.stderr}\n${pushResult.stdout}`).toContain(
			GITHUB_SOURCE_OF_TRUTH_MESSAGE
		)
		expect(lsResult.exitCode, lsResult.stderr).toBe(0)
	})

	test('rejects SSH pushes to GitHub mirrored repositories without breaking fetches', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'ssh-mirror@example.com',
			username: 'ssh-mirror',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'SSH Mirror',
			slug: 'ssh-mirror',
			visibility: 'public',
		})
		await createGitHubMirroredExternalSource({
			externalRepositoryId: 3_702n,
			fullName: 'ssh-mirror/ssh-mirror',
			name: 'ssh-mirror',
			ownerLogin: 'ssh-mirror',
			repositoryId: repository.id,
		})
		const key = await createSshKeyPair('ssh-mirror')
		await createSshPublicKey({
			apiBaseUrl,
			headers,
			publicKey: key.publicKey,
			title: 'Mirror SSH key',
		})
		const localRepository = `${runDirectory}/ssh-mirror-push`
		const remoteUrl = sshUrl(ports.gitSsh, 'ssh-mirror', repository.slug)

		await createCommittedRepository(localRepository, 'README.md', '# Mirror\n')
		const pushResult = await pushRepositoryOverSsh(
			localRepository,
			remoteUrl,
			key.privateKeyPath
		)
		const cloneResult = await cloneRepositoryOverSsh(
			remoteUrl,
			`${runDirectory}/ssh-mirror-clone`,
			key.privateKeyPath
		)

		expect(pushResult.exitCode).not.toBe(0)
		expect(`${pushResult.stderr}\n${pushResult.stdout}`).toContain(
			GITHUB_SOURCE_OF_TRUTH_MESSAGE
		)
		expect(cloneResult.exitCode, cloneResult.stderr).toBe(0)
	})

	test('rejects unregistered SSH keys before repository access', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'ssh-denied@example.com',
			username: 'ssh-denied',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'SSH Denied',
			slug: 'ssh-denied',
		})
		const key = await createSshKeyPair('ssh-denied')
		const localRepository = `${runDirectory}/ssh-denied-push`

		await createCommittedRepository(localRepository, 'README.md', '# Denied\n')
		const pushResult = await pushRepositoryOverSsh(
			localRepository,
			sshUrl(ports.gitSsh, 'ssh-denied', repository.slug),
			key.privateKeyPath
		)
		const browserSummary = await getBrowserSummary(
			apiBaseUrl,
			'ssh-denied',
			repository.slug,
			headers
		)

		expect(pushResult.exitCode).not.toBe(0)
		expect(browserSummary.isEmpty).toBe(true)
		expect(browserSummary.rootEntries).toEqual([])
	})

	test('rejects anonymous clones of private repositories', async () => {
		const headers = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'marta-private@example.com',
			username: 'marta-private',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers,
			name: 'Private Notes',
			slug: 'private-notes',
		})

		const lsResult = await lsRemote(
			smartHttpUrl(ports.gitHttp, 'marta-private', repository.slug)
		)
		expect(lsResult.exitCode).not.toBe(0)
	})

	test('rejects invalid, read-only, and other-user tokens for pushes', async () => {
		const ownerHeaders = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'owner@example.com',
			username: 'owner',
		})
		const otherHeaders = await createTestSessionHeaders({
			apiBaseUrl,
			email: 'other@example.com',
			username: 'other',
		})
		const { repository } = await createRepository({
			apiBaseUrl,
			headers: ownerHeaders,
			name: 'Protected Notes',
			slug: 'protected-notes',
		})
		const readOnlyToken = await createGitAccessToken({
			apiBaseUrl,
			headers: ownerHeaders,
			permissions: ['git:read'],
		})
		const otherUserToken = await createGitAccessToken({
			apiBaseUrl,
			headers: otherHeaders,
			permissions: ['git:write'],
		})

		const invalidTokenPushResult = await pushWithFreshRepository(
			'invalid-token',
			smartHttpUrl(ports.gitHttp, 'owner', repository.slug, 'tes_git_invalid')
		)
		const readOnlyTokenPushResult = await pushWithFreshRepository(
			'read-only-token',
			smartHttpUrl(ports.gitHttp, 'owner', repository.slug, readOnlyToken)
		)
		const otherUserTokenPushResult = await pushWithFreshRepository(
			'other-user-token',
			smartHttpUrl(ports.gitHttp, 'owner', repository.slug, otherUserToken)
		)

		expect(invalidTokenPushResult.exitCode).not.toBe(0)
		expect(readOnlyTokenPushResult.exitCode).not.toBe(0)
		expect(otherUserTokenPushResult.exitCode).not.toBe(0)
		const browserSummary = await getBrowserSummary(
			apiBaseUrl,
			'owner',
			repository.slug,
			ownerHeaders
		)

		expect(browserSummary.isEmpty).toBe(true)
		expect(browserSummary.rootEntries).toEqual([])
	})

	async function pushWithFreshRepository(name: string, remoteUrl: string) {
		const localRepository = `${runDirectory}/${name}`
		await createCommittedRepository(localRepository, 'README.md', `# ${name}\n`)

		return await pushRepository(localRepository, remoteUrl)
	}

	async function createSshKeyPair(name: string) {
		const privateKeyPath = `${runDirectory}/${name}_ed25519`
		await $`ssh-keygen -t ed25519 -N '' -C ${`${name}@e2e`} -f ${privateKeyPath}`.quiet()
		const publicKey = await file(`${privateKeyPath}.pub`).text()

		return { privateKeyPath, publicKey }
	}
})

async function listPullRequestPushEvents(pullRequestId: PullRequestId) {
	const events = await db
		.select()
		.from(pullRequestEvents)
		.where(eq(pullRequestEvents.pullRequestId, pullRequestId))
		.orderBy(asc(pullRequestEvents.createdAt))

	return events.filter(
		event => event.type === 'head_updated' || event.type === 'force_pushed'
	)
}

/**
 * The hook runs inside receive-pack, so the events exist by the time the push
 * returns. The wait only covers a delivery the sweeper had to retry.
 */
async function waitForPullRequestPushEvents(pullRequestId: PullRequestId) {
	const deadline = Date.now() + 60_000

	while (Date.now() < deadline) {
		const events = await listPullRequestPushEvents(pullRequestId)

		if (events.length > 0) return events

		await sleep(250)
	}

	throw new Error(`timed out waiting for push events on ${pullRequestId}`)
}

interface CreateGitHubMirroredExternalSourceOptions {
	externalRepositoryId: bigint
	fullName: string
	name: string
	ownerLogin: string
	repositoryId: RepositoryId
}

async function createGitHubMirroredExternalSource({
	externalRepositoryId,
	fullName,
	name,
	ownerLogin,
	repositoryId,
}: CreateGitHubMirroredExternalSourceOptions) {
	await db.insert(repositoryExternalSources).values({
		repositoryId,
		externalRepositoryId,
		ownerLogin,
		name,
		fullName,
		sourceUrl: `https://github.com/${fullName}`,
		sourceDefaultBranch: 'main',
		mirrorMode: 'github_to_tessera',
		syncStatus: 'succeeded',
	})
}
