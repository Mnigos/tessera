import type {
	Repository,
	RepositorySyncHealth,
	RepositoryWithOwner,
} from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCutoverGitHubMirrorMutation } from '../hooks/use-cutover-github-mirror.mutation'
import { useEnableGitHubMirrorMutation } from '../hooks/use-enable-github-mirror.mutation'
import { useGitHubReauthorizationQuery } from '../hooks/use-github-reauthorization.query'
import { useGitHubSyncHealthQuery } from '../hooks/use-github-sync-health.query'
import { useRepositoryQuery } from '../hooks/use-repository.query'
import { RepositoryGitHubSettings } from './repository-github-settings'

vi.mock('../hooks/use-repository.query', () => ({
	useRepositoryQuery: vi.fn(),
}))

vi.mock('../hooks/use-github-sync-health.query', () => ({
	useGitHubSyncHealthQuery: vi.fn(),
}))

vi.mock('../hooks/use-github-reauthorization.query', () => ({
	useGitHubReauthorizationQuery: vi.fn(),
}))

vi.mock('../hooks/use-cutover-github-mirror.mutation', () => ({
	useCutoverGitHubMirrorMutation: vi.fn(),
}))

vi.mock('../hooks/use-enable-github-mirror.mutation', () => ({
	useEnableGitHubMirrorMutation: vi.fn(),
}))

const useRepositoryQueryMock = vi.mocked(useRepositoryQuery)
const useGitHubSyncHealthQueryMock = vi.mocked(useGitHubSyncHealthQuery)
const useGitHubReauthorizationQueryMock = vi.mocked(
	useGitHubReauthorizationQuery
)
const useCutoverGitHubMirrorMutationMock = vi.mocked(
	useCutoverGitHubMirrorMutation
)
const useEnableGitHubMirrorMutationMock = vi.mocked(
	useEnableGitHubMirrorMutation
)

const cutoverMutateMock = vi.fn()
const enableMutateMock = vi.fn()

const AUTHORITY_BUTTON_NAME = 'Make Tessera authoritative'
const SOURCE_REPOSITORY_LINK_REGEX = /mnigos\/upstream-notes/
const SYNC_BUTTON_REGEX = /sync/i
const RETRY_BUTTON_REGEX = /retry/i
const RESTORE_ACCESS_REGEX = /Restore access/
const LAST_RUN_REGEX = /last run/

const EXTERNAL_SOURCE = {
	mode: 'github_to_tessera',
	provider: 'github',
	externalRepositoryId: '123456',
	ownerLogin: 'mnigos',
	name: 'upstream-notes',
	fullName: 'mnigos/upstream-notes',
	sourceUrl: 'https://github.com/mnigos/upstream-notes',
	sourceDefaultBranch: 'main',
	syncStatus: 'succeeded',
	lastSyncSucceededAt: new Date('2026-06-15T10:01:00.000Z'),
	createdAt: new Date('2026-06-01T00:00:00.000Z'),
	updatedAt: new Date('2026-06-15T10:01:00.000Z'),
} satisfies Repository['externalSource']

const BASE_SYNC_HEALTH = {
	pendingDeliveryCount: 0,
	retryCount24h: 0,
	failureRate24h: 0,
	reauthorizationRequired: false,
} satisfies Omit<RepositorySyncHealth, 'state'>

function mockRepository(
	externalSource: Repository['externalSource'] = EXTERNAL_SOURCE
) {
	useRepositoryQueryMock.mockReturnValue({
		data: {
			repository: {
				id: '8d6ced61-1733-4aca-abba-ccbb9991cd08',
				slug: 'tessera-notes',
				name: 'Tessera Notes',
				visibility: 'public',
				defaultBranch: 'main',
				externalSource,
				cloneUrls: {
					authority: 'tessera',
					https: 'http://git.localhost/mnigos/tessera-notes.git',
					ssh: 'ssh://git@localhost:2222/mnigos/tessera-notes.git',
				},
				createdAt: new Date('2026-01-01T00:00:00.000Z'),
				updatedAt: new Date('2026-01-02T00:00:00.000Z'),
			},
			owner: { kind: 'user', handle: 'mnigos', username: 'mnigos' },
		} as unknown as RepositoryWithOwner,
		error: null,
		isError: false,
		isLoading: false,
	} as unknown as ReturnType<typeof useRepositoryQuery>)
}

function mockSyncHealth(syncHealth?: RepositorySyncHealth, isLoading = false) {
	useGitHubSyncHealthQueryMock.mockReturnValue({
		data: syncHealth ? { syncHealth } : undefined,
		isError: false,
		isLoading,
	} as unknown as ReturnType<typeof useGitHubSyncHealthQuery>)
}

function renderSettings() {
	return render(
		<RepositoryGitHubSettings slug="tessera-notes" username="mnigos" />
	)
}

describe('RepositoryGitHubSettings', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		cutoverMutateMock.mockClear()
		enableMutateMock.mockClear()
	})

	beforeEach(() => {
		mockRepository()
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state: 'healthy' })
		useGitHubReauthorizationQueryMock.mockReturnValue({
			data: { reauthorizationRequired: false },
			isError: false,
			isLoading: false,
		} as unknown as ReturnType<typeof useGitHubReauthorizationQuery>)
		useCutoverGitHubMirrorMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			isSuccess: false,
			mutate: cutoverMutateMock,
		} as unknown as ReturnType<typeof useCutoverGitHubMirrorMutation>)
		useEnableGitHubMirrorMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			isSuccess: false,
			mutate: enableMutateMock,
		} as unknown as ReturnType<typeof useEnableGitHubMirrorMutation>)
	})

	test('shows the source, its details, and the full sync health', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'partial',
			pendingDeliveryCount: 3,
			retryCount24h: 2,
			failureRate24h: 0.25,
			freshnessLagSeconds: 7200,
			lastReconciliationDurationMs: 1200,
		})

		renderSettings()

		expect(
			screen.getByRole('heading', { name: 'Source repository' })
		).toBeTruthy()
		expect(
			screen.getByRole('link', { name: SOURCE_REPOSITORY_LINK_REGEX })
		).toBeTruthy()
		expect(screen.getByRole('heading', { name: 'Sync health' })).toBeTruthy()
		expect(screen.getByText('Partly synced')).toBeTruthy()
		expect(screen.getByText('2 hours ago')).toBeTruthy()
		expect(screen.getByText('25%')).toBeTruthy()
		expect(screen.getByText('1200 ms')).toBeTruthy()
	})

	// Non-admins never reach this component, so a load failure is a real failure.
	test('reports a failed load without offering anything to configure', () => {
		useRepositoryQueryMock.mockReturnValue({
			data: undefined,
			error: new Error('network unavailable'),
			isError: true,
			isLoading: false,
		} as unknown as ReturnType<typeof useRepositoryQuery>)

		renderSettings()

		expect(
			screen.getByRole('heading', {
				name: 'GitHub settings could not be loaded',
			})
		).toBeTruthy()
		expect(screen.queryByRole('heading', { name: 'Sync health' })).toBeNull()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_NAME })
		).toBeNull()
	})

	test('lets the owner enable mirroring on an imported repository, and offers no cutover', async () => {
		const user = userEvent.setup()
		mockRepository({ ...EXTERNAL_SOURCE, mode: 'imported' })

		renderSettings()

		expect(
			screen.getByRole('heading', { name: 'Automatic mirroring' })
		).toBeTruthy()
		expect(screen.queryByRole('heading', { name: 'Sync health' })).toBeNull()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_NAME })
		).toBeNull()

		await user.click(screen.getByRole('button', { name: 'Enable mirror' }))

		expect(enableMutateMock).toHaveBeenCalledWith({
			username: 'mnigos',
			slug: 'tessera-notes',
		})
	})

	// The enable mutation settles before the reads that replace this section do.
	// Re-offering the button in that window invites a second, redundant request.
	test('keeps the enable affordance disabled while the refreshed state lands', () => {
		mockRepository({ ...EXTERNAL_SOURCE, mode: 'imported' })
		useEnableGitHubMirrorMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			isSuccess: true,
			mutate: enableMutateMock,
		} as unknown as ReturnType<typeof useEnableGitHubMirrorMutation>)

		renderSettings()

		const enableButton = screen.getByRole('button', { name: 'Enabling…' })

		expect(enableButton.hasAttribute('disabled')).toBe(true)
		expect(screen.queryByRole('button', { name: 'Enable mirror' })).toBeNull()
	})

	test('hides the authority control once authority has changed', () => {
		useCutoverGitHubMirrorMutationMock.mockReturnValue({
			isError: false,
			isPending: false,
			isSuccess: true,
			mutate: cutoverMutateMock,
		} as unknown as ReturnType<typeof useCutoverGitHubMirrorMutation>)

		renderSettings()

		expect(screen.getByText('Tessera is now authoritative.')).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_NAME })
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: 'Confirm authority change' })
		).toBeNull()
	})

	test('confirms the authority change before performing it', async () => {
		const user = userEvent.setup()

		renderSettings()

		await user.click(
			screen.getByRole('button', { name: AUTHORITY_BUTTON_NAME })
		)

		expect(
			screen.getByText(
				'This stops GitHub-to-Tessera synchronization. Future writes must target Tessera.'
			)
		).toBeTruthy()

		await user.click(
			screen.getByRole('button', { name: 'Confirm authority change' })
		)

		expect(cutoverMutateMock).toHaveBeenCalledWith({
			username: 'mnigos',
			slug: 'tessera-notes',
		})
	})

	test.each([
		[
			'stale',
			'Waiting for a fresh sync. Authority can change once one completes.',
		],
		[
			'partial',
			'Some GitHub updates are still awaiting reconciliation. Authority can change once a run completes cleanly.',
		],
		[
			'pending',
			'Synchronization is queued or in progress. Authority can change once it finishes.',
		],
		[
			'failed',
			'Synchronization is not completing. Authority can change once a run succeeds.',
		],
		// Neutral by default: a block Tessera caused itself is not GitHub's to fix.
		[
			'blocked',
			'Synchronization is stopped. Authority can change once it resumes and completes.',
		],
	] as const)('refuses cutover while sync health is %s, and says why', (state, reason) => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state })

		renderSettings()

		expect(screen.getByText(reason)).toBeTruthy()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_NAME })
		).toBeNull()
	})

	test('waits for health rather than calling it unavailable while it loads', () => {
		mockSyncHealth(undefined, true)

		renderSettings()

		expect(
			screen.queryByText('Synchronization health is unavailable right now.')
		).toBeNull()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_NAME })
		).toBeNull()
	})

	test('omits the next scheduled sync when nothing is scheduled', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'blocked',
			code: 'installation_suspended',
		})

		renderSettings()

		// "Never" here would contradict the retry copy on the same screen.
		expect(screen.queryByText('Next scheduled sync')).toBeNull()
	})

	test('shows the next scheduled sync when one is actually scheduled', () => {
		mockRepository({
			...EXTERNAL_SOURCE,
			nextSyncAt: new Date('2026-06-15T11:00:00.000Z'),
		})

		renderSettings()

		expect(screen.getByText('Next scheduled sync')).toBeTruthy()
	})

	test('explains a rate-limited hold as waiting rather than as a failure', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'pending',
			code: 'rate_limited',
			rateLimitedUntil: new Date('2026-06-15T11:00:00.000Z'),
		})

		renderSettings()

		expect(screen.getByText('Waiting on GitHub')).toBeTruthy()
		expect(
			screen.getByText(
				"Waiting for GitHub's rate limit to reset. Authority can change once a run completes."
			)
		).toBeTruthy()
		expect(screen.getByText('Rate limit resets')).toBeTruthy()
		expect(screen.queryByText('Sync failed')).toBeNull()
	})

	test('offers reauthorization guidance without offering a sync', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'blocked',
			code: 'installation_suspended',
			reauthorizationRequired: true,
		})
		useGitHubReauthorizationQueryMock.mockReturnValue({
			data: {
				reauthorizationRequired: true,
				installUrl: 'https://github.com/apps/tessera/installations/new',
			},
			isError: false,
			isLoading: false,
		} as unknown as ReturnType<typeof useGitHubReauthorizationQuery>)

		renderSettings()

		expect(
			screen.getByRole('heading', { name: 'Access has to be granted again' })
		).toBeTruthy()
		expect(
			screen
				.getByRole('link', { name: 'Review the GitHub App installation' })
				.getAttribute('href')
		).toBe('https://github.com/apps/tessera/installations/new')
		expect(screen.queryByRole('button', { name: SYNC_BUTTON_REGEX })).toBeNull()
		expect(
			screen.queryByRole('button', { name: RETRY_BUTTON_REGEX })
		).toBeNull()
	})

	test('reports a reauthorization link that failed to load, and offers a reload', async () => {
		const user = userEvent.setup()
		const refetch = vi.fn()
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'blocked',
			code: 'authentication_failed',
			reauthorizationRequired: true,
		})
		// TES-69 rejects rather than reporting a required reauthorization it
		// cannot direct anybody to, so this is a reachable response.
		useGitHubReauthorizationQueryMock.mockReturnValue({
			data: undefined,
			isError: true,
			isLoading: false,
			refetch,
		} as unknown as ReturnType<typeof useGitHubReauthorizationQuery>)

		renderSettings()

		expect(
			screen.getByRole('heading', { name: 'Access has to be granted again' })
		).toBeTruthy()
		expect(
			screen.getByText('The reauthorization link could not be loaded.')
		).toBeTruthy()

		await user.click(screen.getByRole('button', { name: 'Retry' }))

		expect(refetch).toHaveBeenCalled()
		// Reloading a link is not a synchronization retry.
		expect(screen.queryByRole('button', { name: SYNC_BUTTON_REGEX })).toBeNull()
	})

	test('blames storage rather than GitHub access when storage is the block', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'blocked',
			code: 'missing_storage',
			reauthorizationRequired: false,
		})

		renderSettings()

		expect(
			screen.getByText(
				"This repository's storage is unavailable to Tessera, so nothing can be synchronized."
			)
		).toBeTruthy()
		expect(
			screen.queryByRole('heading', { name: 'Access has to be granted again' })
		).toBeNull()
		expect(screen.queryByText(RESTORE_ACCESS_REGEX)).toBeNull()
	})

	// Derived from the backend facts asserted in
	// apps/api/.../repository-sync-health.spec.ts: `running` maps to `pending`,
	// and a clean run with an outstanding delivery maps to `partial`.
	test('describes a run already in progress without calling it merely queued', () => {
		mockSyncHealth({ ...BASE_SYNC_HEALTH, state: 'pending' })

		renderSettings()

		expect(
			screen.getByText('Synchronization is queued or in progress.')
		).toBeTruthy()
	})

	test('does not blame a clean run for a delivery that arrived after it', () => {
		mockSyncHealth({
			...BASE_SYNC_HEALTH,
			state: 'partial',
			pendingDeliveryCount: 1,
		})

		renderSettings()

		expect(
			screen.getByText(
				'Some GitHub updates are awaiting reconciliation, so data may be missing here.'
			)
		).toBeTruthy()
		expect(screen.queryByText(LAST_RUN_REGEX)).toBeNull()
	})

	test('keeps historical source detail after cutover, with nothing left to configure', () => {
		mockRepository({ ...EXTERNAL_SOURCE, mode: 'tessera_source' })

		renderSettings()

		expect(
			screen.getByRole('heading', { name: 'Historical source' })
		).toBeTruthy()
		expect(
			screen.getByRole('link', { name: SOURCE_REPOSITORY_LINK_REGEX })
		).toBeTruthy()
		expect(screen.queryByRole('heading', { name: 'Sync health' })).toBeNull()
		expect(
			screen.queryByRole('button', { name: AUTHORITY_BUTTON_NAME })
		).toBeNull()
		expect(screen.queryByRole('button', { name: 'Enable mirror' })).toBeNull()
	})

	test('says plainly when a repository has no GitHub source at all', () => {
		mockRepository({ mode: 'none' })

		renderSettings()

		expect(
			screen.getByRole('heading', { name: 'No GitHub source' })
		).toBeTruthy()
	})
})
