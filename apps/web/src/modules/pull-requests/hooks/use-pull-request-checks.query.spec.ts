import { useQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'
import {
	getPullRequestChecksQueryOptions,
	usePullRequestChecksQuery,
} from './use-pull-request-checks.query'

vi.mock('@tanstack/react-query', () => ({
	useQuery: vi.fn(options => options),
}))

vi.mock('@/lib/orpc/query', () => ({
	orpcQuery: {
		pullRequests: {
			listChecks: { queryOptions: vi.fn(options => options) },
		},
	},
}))

describe('pull request checks query', () => {
	test('keeps input and enabled inside generated query options', () => {
		const input = {
			username: 'marta',
			slug: 'notes',
			number: '1',
			expectedHeadSha: 'a'.repeat(40),
		}

		expect(getPullRequestChecksQueryOptions(input, false)).toEqual({
			input,
			enabled: false,
		})
		expect(orpcQuery.pullRequests.listChecks.queryOptions).toHaveBeenCalledWith(
			{
				input,
				enabled: false,
			}
		)

		usePullRequestChecksQuery(input)
		expect(useQuery).toHaveBeenCalledWith({ input, enabled: true })
	})

	test('keys a different head separately from the one already cached', () => {
		const target = { username: 'marta', slug: 'notes', number: '1' }

		expect(
			getPullRequestChecksQueryOptions({
				...target,
				expectedHeadSha: 'a'.repeat(40),
			})
		).not.toEqual(
			getPullRequestChecksQueryOptions({
				...target,
				expectedHeadSha: 'b'.repeat(40),
			})
		)
	})
})
