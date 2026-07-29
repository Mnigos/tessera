import { Octokit } from '@octokit/rest'
import { GitHubSyncClient } from './github-sync.client'

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))

const REPOSITORY = {
	id: 456,
	node_id: 'repository-node',
	owner: {
		id: 9,
		node_id: 'organization-node',
		login: 'tessera-org',
		type: 'Organization',
	},
	name: 'notes',
	full_name: 'tessera-org/notes',
	html_url: 'https://github.com/tessera-org/notes',
	clone_url: 'https://github.com/tessera-org/notes.git',
	default_branch: 'main',
}

function createPullRequest(number: number, updatedAt: string) {
	return {
		id: number,
		node_id: `pull-request-${number}`,
		number,
		html_url: `https://github.com/tessera-org/notes/pull/${number}`,
		title: `Pull request ${number}`,
		body: null,
		state: 'open',
		draft: false,
		user: {
			id: 7,
			node_id: 'user-node',
			login: 'marta',
			type: 'User',
		},
		merged_at: null,
		merged_by: null,
		merge_commit_sha: null,
		created_at: '2026-07-20T00:00:00Z',
		updated_at: updatedAt,
		closed_at: null,
		head: {
			ref: `feature-${number}`,
			sha: `head-${number}`,
			repo: { node_id: 'repository-node' },
		},
		base: {
			ref: 'main',
			sha: 'base-sha',
			repo: { node_id: 'repository-node' },
		},
	}
}

describe(GitHubSyncClient.name, () => {
	const request = vi.fn()
	const paginate = vi.fn()
	const list = vi.fn()
	const get = vi.fn()

	beforeEach(() => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date('2026-07-29T12:00:00.500Z'))
		request.mockResolvedValue({
			data: REPOSITORY,
			headers: { date: 'Wed, 29 Jul 2026 12:00:00 GMT' },
		})
		vi.mocked(Octokit).mockImplementation(
			class {
				request = request
				paginate = paginate
				rest = { pulls: { list, get } }
			} as never
		)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	test('stops pagination after the persisted update cursor', async () => {
		paginate.mockImplementation((_endpoint, _options, mapPage) => {
			const done = vi.fn()
			const pullRequests = mapPage(
				{
					data: [
						createPullRequest(2, '2026-07-29T11:00:00Z'),
						createPullRequest(1, '2026-07-28T11:00:00Z'),
					],
				},
				done
			)

			expect(done).toHaveBeenCalledOnce()

			return pullRequests
		})

		const client = new GitHubSyncClient()
		const reconciliation = await client.getRepositoryReconciliation({
			accessToken: 'installation-token',
			externalRepositoryId: 456n,
			updatedAfter: new Date('2026-07-29T00:00:00Z'),
		})

		expect(reconciliation.pullRequests).toEqual([
			expect.objectContaining({ number: 2 }),
		])
		expect(reconciliation.pullRequestCursorAt).toEqual(
			new Date('2026-07-29T12:00:00Z')
		)
		expect(paginate).toHaveBeenCalledWith(
			list,
			expect.objectContaining({ sort: 'updated', direction: 'desc' }),
			expect.any(Function)
		)
		expect(get).not.toHaveBeenCalled()
	})

	test('includes updates from the same provider-clock second', async () => {
		paginate.mockImplementation((_endpoint, _options, mapPage) =>
			mapPage(
				{
					data: [createPullRequest(3, '2026-07-29T12:00:00Z')],
				},
				vi.fn()
			)
		)

		const client = new GitHubSyncClient()
		const reconciliation = await client.getRepositoryReconciliation({
			accessToken: 'installation-token',
			externalRepositoryId: 456n,
			updatedAfter: new Date('2026-07-29T12:00:00Z'),
		})

		expect(reconciliation.pullRequests).toEqual([
			expect.objectContaining({ number: 3 }),
		])
	})
})
