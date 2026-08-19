import type { RepositorySyncHealth } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { useGitHubSyncHealthQuery } from '@/modules/repositories/hooks/use-github-sync-health.query'
import { usePullRequestThreadsQuery } from '../hooks/use-pull-request-threads.query'
import { PullRequestTimeline } from './pull-request-timeline'

vi.mock('../hooks/use-pull-request-activity.query', () => ({
	usePullRequestActivityQuery: () => ({ data: undefined }),
}))

vi.mock('../hooks/use-refresh-pull-request-github.mutation', () => ({
	useRefreshPullRequestGitHubMutation: () => ({
		isPending: false,
		mutate: vi.fn(),
	}),
}))

vi.mock('@/modules/repositories/hooks/use-github-sync-health.query', () => ({
	useGitHubSyncHealthQuery: vi.fn(),
}))

vi.mock('../hooks/use-pull-request-threads.query', () => ({
	usePullRequestThreadsQuery: vi.fn(),
}))

vi.mock('../hooks/use-create-pull-request-thread.mutation', () => ({
	useCreatePullRequestThreadMutation: () => ({
		isError: false,
		isPending: false,
		mutate: vi.fn(),
	}),
}))

const useGitHubSyncHealthQueryMock = vi.mocked(useGitHubSyncHealthQuery)
const useThreadsQueryMock = vi.mocked(usePullRequestThreadsQuery)

const BASE_SYNC_HEALTH = {
	pendingDeliveryCount: 0,
	retryCount24h: 0,
	failureRate24h: 0,
	reauthorizationRequired: false,
} satisfies Omit<RepositorySyncHealth, 'state'>

const NO_ACTIVITY_REGEX = /No activity yet\./
const INCOMPLETE_ACTIVITY_REGEX =
	/GitHub data may not be fully synchronized, so this activity can be incomplete\./
const UNSYNCHRONIZED_NOTICE_REGEX = /GitHub data may not be fully synchronized/
const SYNC_BUTTON_REGEX = /sync/i

function mockSyncHealth(syncHealth?: RepositorySyncHealth) {
	useGitHubSyncHealthQueryMock.mockReturnValue({
		data: syncHealth ? { syncHealth } : undefined,
		isError: false,
		isLoading: false,
	} as unknown as ReturnType<typeof useGitHubSyncHealthQuery>)
}

interface RenderTimelineOptions {
	isFromGitHub?: boolean
	isGitHubAuthoritative?: boolean
	canReadSyncHealth?: boolean
}

function renderTimeline(options: RenderTimelineOptions = {}) {
	return render(
		<PullRequestTimeline
			canReadSyncHealth={options.canReadSyncHealth ?? true}
			events={[]}
			isFromGitHub={options.isFromGitHub ?? true}
			isGitHubAuthoritative={options.isGitHubAuthoritative ?? true}
			number="1"
			slug="notes"
			username="marta"
		/>
	)
}

describe('pull request timeline synchronization context', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	beforeEach(() => {
		mockSyncHealth()
		useThreadsQueryMock.mockReturnValue({
			data: {
				threads: [],
				comparison: { headSha: 'head-sha' },
				viewer: {
					canComment: false,
					canResolveAnyThread: false,
					canDeleteAnyComment: false,
				},
			},
			isError: false,
			isLoading: false,
			refetch: vi.fn(),
		} as unknown as ReturnType<typeof usePullRequestThreadsQuery>)
	})

	test('never claims a synchronized pull request has no activity', () => {
		renderTimeline()

		expect(
			screen.getByText('No activity has synchronized from GitHub yet.')
		).toBeTruthy()
		expect(screen.queryByText(NO_ACTIVITY_REGEX)).toBeNull()
	})

	test('still says nothing has synchronized when health cannot be read', () => {
		renderTimeline({ canReadSyncHealth: false })

		expect(
			screen.getByText('No activity has synchronized from GitHub yet.')
		).toBeTruthy()
		expect(screen.queryByText(NO_ACTIVITY_REGEX)).toBeNull()
	})

	test('keeps the plain empty copy for a native pull request', () => {
		renderTimeline({ isFromGitHub: false })

		expect(screen.getByText('No activity yet.')).toBeTruthy()
	})

	// Cutover ends synchronization; it does not retroactively make whatever
	// GitHub sent complete, so the copy must not start asserting absence.
	test('keeps the synchronized empty copy after authority returns to Tessera', () => {
		renderTimeline({ isFromGitHub: true, isGitHubAuthoritative: false })

		expect(
			screen.getByText('No activity has synchronized from GitHub yet.')
		).toBeTruthy()
		expect(screen.queryByText(NO_ACTIVITY_REGEX)).toBeNull()
	})

	test('stops asking for sync health once authority has returned to Tessera', () => {
		renderTimeline({ isFromGitHub: true, isGitHubAuthoritative: false })

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			false
		)
	})

	// A native pull request frozen by its repository being mirrored has no GitHub
	// history, so it has nothing to be behind on and must not be warned about it.
	test('does not ask for sync health for a native pull request in a mirrored repository', () => {
		renderTimeline({ isFromGitHub: false, isGitHubAuthoritative: true })

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			false
		)
		expect(screen.getByText('No activity yet.')).toBeTruthy()
	})

	test('asks for sync health only on behalf of an owner of a running mirror', () => {
		renderTimeline({ canReadSyncHealth: false })

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			false
		)

		useGitHubSyncHealthQueryMock.mockClear()
		mockSyncHealth()

		renderTimeline({ canReadSyncHealth: true })

		expect(useGitHubSyncHealthQueryMock).toHaveBeenCalledWith(
			expect.anything(),
			true
		)
	})

	test.each([
		'stale',
		'partial',
		'failed',
		'blocked',
		'pending',
	] as const)('warns that %s synchronization may leave the activity incomplete', state => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state })

		renderTimeline()

		expect(screen.getByText(INCOMPLETE_ACTIVITY_REGEX)).toBeTruthy()
		// The notice explains; it never offers a synchronization to trigger.
		expect(screen.queryByRole('button', { name: SYNC_BUTTON_REGEX })).toBeNull()
	})

	test('stays silent while the mirror is healthy', () => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state: 'healthy' })

		renderTimeline()

		expect(screen.queryByText(UNSYNCHRONIZED_NOTICE_REGEX)).toBeNull()
	})

	test('reads an active rate-limited hold as waiting rather than as a failure', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'stale',
			code: 'rate_limited',
			rateLimitedUntil: new Date('2026-06-15T11:00:00.000Z'),
		})

		renderTimeline()

		expect(screen.getByText('Waiting on GitHub.')).toBeTruthy()
		expect(screen.queryByText('Sync failed.')).toBeNull()
	})

	// Once the reset passes the API keeps the code but drops the timestamp; the
	// notice must then describe the state the mirror actually landed in.
	test('stops saying it is waiting once the rate limit has reset', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'failed',
			code: 'rate_limited',
		})

		renderTimeline()

		expect(screen.getByText('Sync failed.')).toBeTruthy()
		expect(screen.queryByText('Waiting on GitHub.')).toBeNull()
	})
})
