import type { OrganizationId } from '@repo/domain'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDeleteOrganizationMutation } from './use-delete-organization.mutation'
import { useUpdateOrganizationMutation } from './use-update-organization.mutation'

vi.mock('@tanstack/react-query', () => ({
	useMutation: vi.fn(options => options),
	useQueryClient: vi.fn(),
}))
vi.mock('@/lib/orpc/query', () => ({
	orpcQuery: {
		handles: { get: { key: vi.fn(() => ['handles', 'get']) } },
		organizations: {
			update: { mutationOptions: vi.fn(options => options) },
			delete: { mutationOptions: vi.fn(options => options) },
			list: { key: vi.fn(() => ['organizations', 'list']) },
			get: {
				key: vi.fn(() => ['organizations', 'get']),
				queryKey: vi.fn(({ input }) => [
					'organizations',
					'get',
					input.organizationId,
				]),
			},
		},
	},
}))

const useMutationMock = vi.mocked(useMutation)
const useQueryClientMock = vi.mocked(useQueryClient)
const organizationId = '00000000-0000-4000-8000-000000000010' as OrganizationId

describe('organization handle cache mutations', () => {
	const removeQueries = vi.fn()
	const invalidateQueries = vi.fn().mockResolvedValue(undefined)

	beforeEach(() => {
		useQueryClientMock.mockReturnValue({
			removeQueries,
			invalidateQueries,
		} as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('removes handle queries after an organization update', async () => {
		useUpdateOrganizationMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onSuccess: () => Promise<void>
		}

		await options.onSuccess()

		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: ['handles', 'get'],
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['organizations', 'list'],
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['organizations', 'get'],
		})
	})

	test('removes organization detail and handle queries after deletion', async () => {
		useDeleteOrganizationMutation()
		const options = useMutationMock.mock.calls.at(-1)?.[0] as {
			onSuccess: (
				result: unknown,
				input: { organizationId: OrganizationId }
			) => Promise<void>
		}

		await options.onSuccess(undefined, { organizationId })

		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: ['organizations', 'get', organizationId],
		})
		expect(removeQueries).toHaveBeenCalledWith({
			queryKey: ['handles', 'get'],
		})
		expect(invalidateQueries).toHaveBeenCalledWith({
			queryKey: ['organizations', 'list'],
		})
	})
})
