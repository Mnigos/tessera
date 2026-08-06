import { useMutation, useQueryClient } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'
import { useCreatePullRequestThreadMutation } from './use-create-pull-request-thread.mutation'
import { useDeletePullRequestCommentMutation } from './use-delete-pull-request-comment.mutation'
import { useEditPullRequestCommentMutation } from './use-edit-pull-request-comment.mutation'
import { getPullRequestThreadsQueryOptions } from './use-pull-request-threads.query'
import { useReplyPullRequestThreadMutation } from './use-reply-pull-request-thread.mutation'
import { useResolvePullRequestThreadMutation } from './use-resolve-pull-request-thread.mutation'
import { useUnresolvePullRequestThreadMutation } from './use-unresolve-pull-request-thread.mutation'

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(options => options),
	useQuery: vi.fn(options => options),
	useQueryClient: vi.fn(),
}))

vi.mock('@/lib/orpc/query', () => {
	function mutationOptions(options: unknown) {
		return options
	}

	return {
		orpcQuery: {
			pullRequests: {
				listThreads: {
					key: vi.fn(() => ['pullRequests', 'listThreads']),
					queryOptions: vi.fn(options => options),
				},
				get: { key: vi.fn(() => ['pullRequests', 'get']) },
				createThread: { mutationOptions: vi.fn(mutationOptions) },
				replyThread: { mutationOptions: vi.fn(mutationOptions) },
				editComment: { mutationOptions: vi.fn(mutationOptions) },
				deleteComment: { mutationOptions: vi.fn(mutationOptions) },
				resolveThread: { mutationOptions: vi.fn(mutationOptions) },
				unresolveThread: { mutationOptions: vi.fn(mutationOptions) },
			},
		},
	}
})

const useQueryClientMock = vi.mocked(useQueryClient)
const useMutationMock = vi.mocked(useMutation)

describe('pull request thread hooks', () => {
	const invalidateQueries = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		useQueryClientMock.mockReturnValue({ invalidateQueries } as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('includes an optional path filter in list thread query options', () => {
		const input = {
			username: 'marta',
			slug: 'notes',
			number: '1',
			path: 'src/index.ts',
		}

		expect(getPullRequestThreadsQueryOptions(input, false)).toEqual({
			input,
			enabled: false,
		})
		expect(
			orpcQuery.pullRequests.listThreads.queryOptions
		).toHaveBeenCalledWith({ input, enabled: false })
	})

	test.each([
		['create', useCreatePullRequestThreadMutation],
		['reply', useReplyPullRequestThreadMutation],
		['delete', useDeletePullRequestCommentMutation],
		['resolve', useResolvePullRequestThreadMutation],
		['unresolve', useUnresolvePullRequestThreadMutation],
	])('%s invalidates threads and pull request detail on success', async (_name, useHook) => {
		useHook()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onSuccess: () => Promise<void>
		}
		await options.onSuccess()

		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['pullRequests', 'listThreads'],
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['pullRequests', 'get'],
		})
	})

	test('edit currently invalidates only threads, documenting missing detail invalidation', async () => {
		useEditPullRequestCommentMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onSuccess: () => Promise<void>
		}
		await options.onSuccess()

		expect(invalidateQueries).toHaveBeenCalledTimes(1)
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['pullRequests', 'listThreads'],
		})
	})
})
