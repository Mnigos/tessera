import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { orpcQuery } from '@/lib/orpc/query'
import { useGitHubImportRepositoriesQuery } from './use-github-import-repositories.query'

vi.mock('@tanstack/react-query', () => ({
	keepPreviousData: vi.fn(),
	useInfiniteQuery: vi.fn(options => options),
}))

vi.mock('@/lib/orpc/query', () => ({
	orpcQuery: {
		githubImport: {
			listRepositories: { infiniteOptions: vi.fn(options => options) },
		},
	},
}))

describe('GitHub import repositories query', () => {
	test('configures paged search through generated infinite options', () => {
		useGitHubImportRepositoriesQuery({ search: 'notes' }, false)
		const infiniteOptions = vi.mocked(
			orpcQuery.githubImport.listRepositories.infiniteOptions
		)
		const options = infiniteOptions.mock.calls[0]?.[0]

		expect(options).toBeTruthy()
		if (!options) return
		expect(options.enabled).toBe(false)
		expect(options.initialPageParam).toBe(1)
		expect(options.placeholderData).toBe(keepPreviousData)
		if (typeof options.input !== 'function')
			throw new Error('Infinite query input factory missing')
		expect(options.input(4)).toEqual({ page: 4, search: 'notes' })
		expect(
			options.getNextPageParam({ repositories: [], nextPage: 5 }, [], 1, [])
		).toBe(5)
		expect(useInfiniteQuery).toHaveBeenCalledWith(options)
	})
})
