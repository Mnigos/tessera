import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { act, renderHook } from '@testing-library/react'
import { authClient } from '@/lib/auth/client'
import { useAuth } from './use-auth'

vi.mock('@tanstack/react-query', () => ({
	useQuery: vi.fn(),
	useQueryClient: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: vi.fn() }))
vi.mock('@/lib/auth/client', () => ({
	authClient: {
		signIn: { social: vi.fn() },
		signOut: vi.fn(),
	},
}))
vi.mock('@/lib/orpc/query', () => ({
	orpcQuery: {
		auth: { session: { queryOptions: vi.fn(options => options) } },
	},
}))

const useQueryMock = vi.mocked(useQuery)
const useQueryClientMock = vi.mocked(useQueryClient)
const useRouterMock = vi.mocked(useRouter)

describe(useAuth.name, () => {
	const clear = vi.fn()
	const invalidate = vi.fn().mockResolvedValue(undefined)
	const navigate = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		useQueryMock.mockReturnValue({
			data: { user: { id: 'user-id' } },
			isLoading: false,
		} as never)
		useQueryClientMock.mockReturnValue({ clear } as never)
		useRouterMock.mockReturnValue({ invalidate, navigate } as never)
		vi.mocked(authClient.signOut).mockImplementation(async options => {
			if (!options) throw new Error('Expected sign-out options')
			await options.fetchOptions?.onSuccess?.({} as never)
			return {} as never
		})
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('clears viewer-scoped queries before invalidating and navigating on sign-out', async () => {
		const { result } = renderHook(() => useAuth())

		await act(() => result.current.signOut())

		expect(clear).toHaveBeenCalledTimes(1)
		expect(invalidate).toHaveBeenCalledTimes(1)
		expect(navigate).toHaveBeenCalledWith({ to: '/' })
		expect(clear.mock.invocationCallOrder[0]).toBeLessThan(
			invalidate.mock.invocationCallOrder[0] ?? 0
		)
	})
})
