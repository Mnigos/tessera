import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRetargetPullRequestMutation } from './use-retarget-pull-request.mutation'

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(options => options),
	useQueryClient: vi.fn(),
}))

vi.mock('@/lib/orpc/query', () => ({
	orpcQuery: {
		pullRequests: {
			retarget: { mutationOptions: vi.fn(options => options) },
			list: { key: vi.fn(() => ['pullRequests', 'list']) },
			get: { key: vi.fn(() => ['pullRequests', 'get']) },
			comparison: { key: vi.fn(() => ['pullRequests', 'comparison']) },
			reviewComparison: {
				key: vi.fn(() => ['pullRequests', 'reviewComparison']),
			},
			fileDiff: { key: vi.fn(() => ['pullRequests', 'fileDiff']) },
			listThreads: { key: vi.fn(() => ['pullRequests', 'listThreads']) },
			listChecks: { key: vi.fn(() => ['pullRequests', 'listChecks']) },
			getMergeRequirements: {
				key: vi.fn(() => ['pullRequests', 'getMergeRequirements']),
			},
		},
	},
}))

const useQueryClientMock = vi.mocked(useQueryClient)
const useMutationMock = vi.mocked(useMutation)

describe('retarget pull request mutation', () => {
	const invalidateQueries = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		useQueryClientMock.mockReturnValue({ invalidateQueries } as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	// Everything the pull request derives from its target branch is dropped, not
	// only the row: the diff, the threads anchored inside it, the checks and what
	// the merge panel is willing to offer all described the old base.
	test('drops every query that described the old target', () => {
		useRetargetPullRequestMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onSuccess: () => void
		}

		options.onSuccess()

		expect(
			invalidateQueries.mock.calls.map(([options]) => options.queryKey)
		).toEqual([
			['pullRequests', 'list'],
			['pullRequests', 'get'],
			['pullRequests', 'comparison'],
			['pullRequests', 'reviewComparison'],
			['pullRequests', 'fileDiff'],
			['pullRequests', 'listThreads'],
			['pullRequests', 'listChecks'],
			['pullRequests', 'getMergeRequirements'],
		])
	})

	// Nothing is awaited: React Query holds the mutation's own result until a
	// promise returned from here settles, and the dialog closes on that result.
	test('returns nothing so the refetches cannot delay the result', () => {
		useRetargetPullRequestMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onSuccess: () => unknown
		}

		expect(options.onSuccess()).toBeUndefined()
	})
})
