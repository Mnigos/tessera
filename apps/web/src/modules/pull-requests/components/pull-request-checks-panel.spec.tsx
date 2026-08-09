import { type Check, type ChecksSummary, checkIdSchema } from '@repo/contracts'
import { render, screen } from '@testing-library/react'
import { usePullRequestChecksQuery } from '../hooks/use-pull-request-checks.query'
import { PullRequestChecksPanel } from './pull-request-checks-panel'

vi.mock('../hooks/use-pull-request-checks.query', () => ({
	usePullRequestChecksQuery: vi.fn(),
}))

const useChecksQueryMock = vi.mocked(usePullRequestChecksQuery)
const EMPTY_CHECKS_REGEX = /No checks have reported/
const GITHUB_ACTIONS_REGEX = /GitHub Actions/
const DETAILS_REGEX = /Details/
const EARLIER_COMMIT_REGEX = /earlier commit/
const REQUIRED_BY_BRANCH_PROTECTION_REGEX = /Required by branch protection/
const NOTHING_TO_SHOW_REGEX = /on this commit yet/
const HEAD_SHA = 'a'.repeat(40)
const EMPTY_COUNTS = {
	queued: 0,
	pending: 0,
	success: 0,
	failure: 0,
	neutral: 0,
	canceled: 0,
	skipped: 0,
	timed_out: 0,
	stale: 0,
}
const SUMMARY: ChecksSummary = {
	headSha: HEAD_SHA,
	overall: 'failure',
	counts: { ...EMPTY_COUNTS, failure: 1 },
	lastResultAt: new Date('2026-08-08T10:00:00Z'),
	headIsCurrent: false,
}
const NO_CHECKS_SUMMARY: ChecksSummary = {
	headSha: HEAD_SHA,
	overall: 'none',
	counts: EMPTY_COUNTS,
	headIsCurrent: true,
}
const CHECK: Check = {
	id: checkIdSchema.parse('00000000-0000-4000-8000-000000000001'),
	kind: 'check_run',
	context: 'build',
	state: 'failure',
	rawStatus: 'completed',
	rawConclusion: 'action_required',
	provider: {
		kind: 'github',
		name: 'GitHub Actions',
		appSlug: 'github-actions',
		url: 'https://github.com/apps/github-actions',
	},
	targetUrl: 'https://github.com/tessera/notes/actions/runs/1',
	outputTitle: 'Tests failed',
	durationMs: 90_000,
	observedAt: new Date('2026-08-08T10:00:00Z'),
}

describe(PullRequestChecksPanel.name, () => {
	afterEach(() => vi.resetAllMocks())

	test('renders no panel and never fetches without a summary', () => {
		render(<PullRequestChecksPanel number="1" slug="notes" username="marta" />)

		expect(screen.queryByText('Checks')).toBeNull()
		expect(useChecksQueryMock).not.toHaveBeenCalled()
	})

	test('stays quiet when nothing reported and nothing is required', () => {
		useChecksQueryMock.mockReturnValue({
			data: { checks: [], missingRequiredContexts: [] },
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={NO_CHECKS_SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.queryByText('Checks')).toBeNull()
	})

	test('shows the failure instead of vanishing when a checkless read errors', () => {
		// The requirements it could not load were the whole of what this panel had
		// to say; disappearing would read as "nothing is required".
		useChecksQueryMock.mockReturnValue({
			data: undefined,
			isLoading: false,
			isError: true,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={NO_CHECKS_SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByRole('alert')).toBeTruthy()
	})

	test('speaks up for a required check nothing reported, with no results at all', () => {
		// The emptiest possible rollup and the most consequential thing the panel
		// can say: the branch demands a check and no provider has ever run it.
		useChecksQueryMock.mockReturnValue({
			data: {
				checks: [],
				missingRequiredContexts: [{ context: 'ci/build', kind: 'status' }],
			},
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={NO_CHECKS_SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByText('Checks')).toBeTruthy()
		expect(screen.getByText('ci/build')).toBeTruthy()
		expect(screen.getByText('Not reported')).toBeTruthy()
		expect(screen.getByText(REQUIRED_BY_BRANCH_PROTECTION_REGEX)).toBeTruthy()
		// The rollup above still says nothing reported, which is true; what must
		// not appear is the body claiming there is nothing to show.
		expect(screen.queryByText(NOTHING_TO_SHOW_REGEX)).toBeNull()
	})

	test('lists missing requirements above the results that did arrive', () => {
		useChecksQueryMock.mockReturnValue({
			data: {
				checks: [CHECK],
				missingRequiredContexts: [{ context: 'ci/lint' }],
			},
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		const rows = screen.getAllByRole('listitem')

		expect(rows[0]?.textContent).toContain('ci/lint')
		expect(rows[1]?.textContent).toContain('build')
	})

	test('fetches the rows for the commit its summary is about', () => {
		useChecksQueryMock.mockReturnValue({
			data: { checks: [CHECK] },
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		expect(useChecksQueryMock).toHaveBeenCalledWith({
			username: 'marta',
			slug: 'notes',
			number: '1',
			expectedHeadSha: HEAD_SHA,
		})
	})

	test('renders loading, error, and empty states', () => {
		useChecksQueryMock.mockReturnValue({
			isLoading: true,
			isError: false,
		} as never)
		const props = {
			username: 'marta',
			slug: 'notes',
			number: '1',
			checksSummary: SUMMARY,
		}
		const { container, rerender } = render(
			<PullRequestChecksPanel {...props} />
		)
		expect(container.querySelector('.animate-pulse')).toBeTruthy()

		useChecksQueryMock.mockReturnValue({
			isLoading: false,
			isError: true,
		} as never)
		rerender(<PullRequestChecksPanel {...props} />)
		expect(screen.getByRole('alert')).toBeTruthy()

		// Reachable whenever the summary says results exist but the rows for this
		// commit do not — a head that moved between the two reads, most of all.
		useChecksQueryMock.mockReturnValue({
			data: { checks: [] },
			isLoading: false,
			isError: false,
		} as never)
		rerender(<PullRequestChecksPanel {...props} />)
		expect(screen.getByText(EMPTY_CHECKS_REGEX)).toBeTruthy()
	})

	test('renders result, provider links, raw tooltip, duration, and stale-head warning', () => {
		useChecksQueryMock.mockReturnValue({
			data: { checks: [CHECK] },
			isLoading: false,
			isError: false,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByText('build')).toBeTruthy()
		expect(screen.getByText('Failed').getAttribute('title')).toBe(
			'action_required'
		)
		expect(screen.getByText('1m 30s')).toBeTruthy()
		expect(
			screen.getByRole('link', { name: GITHUB_ACTIONS_REGEX })
		).toBeTruthy()
		expect(screen.getByRole('link', { name: DETAILS_REGEX })).toBeTruthy()
		expect(screen.getByText(EARLIER_COMMIT_REGEX)).toBeTruthy()
	})

	test('takes head currency from the read that produced the rows', () => {
		// The summary travelled with the pull request and still calls this commit
		// the head; only the checks read, made later, knows it no longer is.
		useChecksQueryMock.mockReturnValue({
			data: { checks: [CHECK], headIsCurrent: false },
			isLoading: false,
			isError: false,
		} as never)
		const props = {
			username: 'marta',
			slug: 'notes',
			number: '1',
			checksSummary: { ...SUMMARY, headIsCurrent: true },
		}
		const { rerender } = render(<PullRequestChecksPanel {...props} />)

		expect(screen.getByText(EARLIER_COMMIT_REGEX)).toBeTruthy()

		// And the other way: a summary that called the commit stale must not keep
		// warning once the rows come back reported on the current head.
		useChecksQueryMock.mockReturnValue({
			data: { checks: [CHECK], headIsCurrent: true },
			isLoading: false,
			isError: false,
		} as never)
		rerender(<PullRequestChecksPanel {...props} checksSummary={SUMMARY} />)

		expect(screen.queryByText(EARLIER_COMMIT_REGEX)).toBeNull()
	})

	test('keeps the summary’s currency until the rows arrive', () => {
		useChecksQueryMock.mockReturnValue({
			isLoading: true,
			isError: false,
		} as never)

		render(
			<PullRequestChecksPanel
				checksSummary={SUMMARY}
				number="1"
				slug="notes"
				username="marta"
			/>
		)

		expect(screen.getByText(EARLIER_COMMIT_REGEX)).toBeTruthy()
	})
})
