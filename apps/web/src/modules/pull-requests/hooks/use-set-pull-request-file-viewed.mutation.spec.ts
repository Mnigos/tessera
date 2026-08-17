import { ORPCError } from '@orpc/client'
import { PULL_REQUEST_STALE_COMPARISON_MESSAGE } from '@repo/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSetPullRequestFileViewedMutation } from './use-set-pull-request-file-viewed.mutation'

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(options => options),
	useQueryClient: vi.fn(),
}))

vi.mock('@/lib/orpc/query', () => ({
	orpcQuery: {
		pullRequests: {
			setFileViewed: {
				mutationKey: vi.fn(() => ['pullRequests', 'setFileViewed']),
				mutationOptions: vi.fn(options => options),
			},
			listViewedFiles: {
				queryKey: vi.fn(({ input }) => [
					'pullRequests',
					'listViewedFiles',
					input,
				]),
				key: vi.fn(() => ['pullRequests', 'listViewedFiles']),
			},
			comparison: {
				key: vi.fn(() => ['pullRequests', 'comparison']),
			},
		},
	},
}))

const useMutationMock = vi.mocked(useMutation)
const useQueryClientMock = vi.mocked(useQueryClient)

describe('set pull request file viewed mutation', () => {
	const cancelQueries = vi.fn().mockResolvedValue(undefined)
	const getQueryData = vi.fn()
	const setQueryData = vi.fn()
	const invalidateQueries = vi.fn().mockResolvedValue(undefined)
	const isMutating = vi.fn(() => 1)

	beforeEach(() => {
		useQueryClientMock.mockReturnValue({
			cancelQueries,
			getQueryData,
			setQueryData,
			invalidateQueries,
			isMutating,
		} as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('optimistically updates viewed paths and rolls back errors', async () => {
		const previous = { headSha: 'a'.repeat(40), paths: ['src/other.ts'] }
		const input = {
			username: 'marta',
			slug: 'notes',
			number: '1',
			expectedHeadSha: previous.headSha,
			path: 'src/index.ts',
			viewed: true,
		}
		getQueryData.mockReturnValue(previous)
		useSetPullRequestFileViewedMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onMutate: (mutationInput: typeof input) => Promise<{
				queryKey: unknown[]
				previous: typeof previous
			}>
			onError: (
				error: unknown,
				mutationInput: typeof input,
				context: { queryKey: unknown[]; previous: typeof previous }
			) => void
		}

		const context = await options.onMutate(input)
		const [, updateViewedFiles] = setQueryData.mock.calls.at(-1) ?? []
		if (typeof updateViewedFiles !== 'function')
			throw new Error('Optimistic updater missing')

		expect(cancelQueries).toHaveBeenCalledWith({ queryKey: context.queryKey })
		expect(updateViewedFiles(previous)).toEqual({
			headSha: previous.headSha,
			paths: ['src/other.ts', 'src/index.ts'],
		})

		options.onError(new Error('failed'), input, context)

		expect(setQueryData).toHaveBeenLastCalledWith(context.queryKey, previous)
	})

	test('invalidates the comparison after a stale-head conflict', () => {
		useSetPullRequestFileViewedMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onError: (
				error: unknown,
				input: unknown,
				context: { queryKey: unknown[]; previous: unknown }
			) => void
		}
		const queryKey = ['pullRequests', 'listViewedFiles', { number: 1 }]
		const previous = { headSha: 'a'.repeat(40), paths: [] }
		const error = new ORPCError('CONFLICT', {
			status: 409,
			message: PULL_REQUEST_STALE_COMPARISON_MESSAGE,
		})

		options.onError(error, {}, { queryKey, previous })

		expect(setQueryData).toHaveBeenCalledWith(queryKey, previous)
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['pullRequests', 'comparison'],
		})
	})
})
