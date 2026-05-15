import { $ } from 'bun'
import {
	createGitAccessToken,
	createRepository,
	createTestSessionHeaders,
	getBlobPreview,
	getBrowserSummary,
} from './helpers/api'
import { migrateGitE2EDatabase, resetGitE2EDatabase } from './helpers/database'
import {
	cloneRepository,
	createCommittedRepository,
	fetchRepository,
	lsRemote,
	pushRepository,
	smartHttpUrl,
} from './helpers/git-cli'
import { getGitE2EPortReservations } from './helpers/ports'
import { startGitE2EProcesses, stopGitE2EProcesses } from './helpers/processes'

interface GitE2EPorts {
	apiGrpc: number
	apiHttp: number
	gitGrpc: number
	gitHttp: number
}

type GitE2EProcesses = Awaited<ReturnType<typeof startGitE2EProcesses>>

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
		const [apiHttp, apiGrpc, gitGrpc, gitHttp] = portReservations.ports
		ports = { apiGrpc, apiHttp, gitGrpc, gitHttp }
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
			permissions: ['git:write'],
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
		expect(fetchResult.exitCode).toBe(0)
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
})
