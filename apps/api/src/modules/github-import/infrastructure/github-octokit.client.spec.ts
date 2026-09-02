import { Logger } from '@nestjs/common'
import type { GitHubImportRepository } from '@repo/contracts'
import {
	GitHubImportAuthenticationError,
	GitHubImportExternalServiceError,
	GitHubImportForbiddenError,
} from '../domain/github-import.errors'
import { GitHubOctokitClient } from './github-octokit.client'

const repository: GitHubImportRepository = {
	githubId: '123',
	ownerLogin: 'marta',
	name: 'tessera',
	fullName: 'marta/tessera',
	visibility: 'private',
	defaultBranch: 'main',
	pushedAt: new Date('2026-05-10T12:34:56Z'),
	githubUrl: 'https://github.com/marta/tessera',
}

const NEXT_PAGE_LINK = '<https://api.github.com/user/repos?page=2>; rel="next"'

function githubRepositoryResponse(id: number, fullName: string) {
	const [ownerLogin = 'marta', name = 'tessera'] = fullName.split('/')

	return {
		id,
		owner: { login: ownerLogin },
		name,
		full_name: fullName,
		visibility: 'private' as const,
		private: true,
		default_branch: 'main',
		pushed_at: '2026-05-10T12:34:56Z',
		html_url: `https://github.com/${fullName}`,
	}
}

describe(GitHubOctokitClient.name, () => {
	let githubOctokitClient: GitHubOctokitClient
	let listForAuthenticatedUser: ReturnType<typeof vi.fn>
	let request: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)
		listForAuthenticatedUser = vi.fn()
		request = vi.fn()
		githubOctokitClient = new GitHubOctokitClient()
		vi.spyOn(githubOctokitClient, 'createForUser').mockReturnValue({
			request,
			rest: {
				repos: {
					listForAuthenticatedUser,
				},
			},
		} as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('lists one requested page with the authenticated GitHub user client', async () => {
		listForAuthenticatedUser.mockResolvedValue({
			data: [githubRepositoryResponse(123, 'marta/tessera')],
			headers: {},
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 3,
			})
		).toEqual({ repositories: [repository], nextPage: undefined })
		expect(githubOctokitClient.createForUser).toHaveBeenCalledWith(
			'github-token'
		)
		expect(listForAuthenticatedUser).toHaveBeenCalledOnce()
		expect(listForAuthenticatedUser).toHaveBeenCalledWith({
			visibility: 'all',
			sort: 'pushed',
			direction: 'desc',
			per_page: 50,
			page: 3,
		})
	})

	test('continues after a full page and stops after a short page', async () => {
		listForAuthenticatedUser.mockResolvedValueOnce({
			data: Array.from({ length: 50 }, (_, index) =>
				githubRepositoryResponse(index + 1, `marta/repository-${index + 1}`)
			),
			headers: { link: NEXT_PAGE_LINK },
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 3,
			})
		).toMatchObject({ nextPage: 4 })
		expect(listForAuthenticatedUser).toHaveBeenCalledOnce()
		listForAuthenticatedUser.mockClear()

		listForAuthenticatedUser.mockResolvedValueOnce({
			data: [githubRepositoryResponse(123, 'marta/tessera')],
			headers: {},
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 4,
			})
		).toEqual({ repositories: [repository], nextPage: undefined })
		expect(listForAuthenticatedUser).toHaveBeenCalledOnce()
	})

	test('stops after a full page that GitHub marks as the last one', async () => {
		listForAuthenticatedUser.mockResolvedValueOnce({
			data: Array.from({ length: 50 }, (_, index) =>
				githubRepositoryResponse(index + 1, `marta/repository-${index + 1}`)
			),
			headers: {
				link: '<https://api.github.com/user/repos?page=1>; rel="prev"',
			},
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 2,
			})
		).toMatchObject({ nextPage: undefined })
	})

	test('scans four search pages in parallel and stops at the first short page', async () => {
		const pages = new Map([
			[
				2,
				Array.from({ length: 50 }, (_, index) =>
					githubRepositoryResponse(
						index + 1,
						index === 2 ? 'LUDUS/Engine' : `marta/repository-${index}`
					)
				),
			],
			[
				3,
				[
					githubRepositoryResponse(100, 'marta/lUdUs-notes'),
					githubRepositoryResponse(101, 'marta/other'),
				],
			],
			[4, [githubRepositoryResponse(200, 'ludus/excluded')]],
			[5, [githubRepositoryResponse(300, 'ludus/also-excluded')]],
		])
		const firstPage = Promise.withResolvers<{
			data: ReturnType<typeof githubRepositoryResponse>[]
			headers: Record<string, string>
		}>()
		listForAuthenticatedUser.mockImplementation(({ page }: { page: number }) =>
			page === 2
				? firstPage.promise
				: Promise.resolve({ data: pages.get(page) ?? [], headers: {} })
		)
		const resultPromise = githubOctokitClient.listRepositories({
			accessToken: 'github-token',
			page: 2,
			search: 'LuDuS',
		})

		expect(listForAuthenticatedUser).toHaveBeenCalledTimes(4)
		expect(
			listForAuthenticatedUser.mock.calls.map(([input]) => input.page)
		).toEqual([2, 3, 4, 5])
		firstPage.resolve({ data: pages.get(2) ?? [], headers: {} })
		expect(await resultPromise).toMatchObject({
			repositories: [
				expect.objectContaining({ fullName: 'LUDUS/Engine' }),
				expect.objectContaining({ fullName: 'marta/lUdUs-notes' }),
			],
			nextPage: undefined,
		})
	})

	test('continues after four full search pages even with zero matches', async () => {
		listForAuthenticatedUser.mockImplementation(({ page }: { page: number }) =>
			Promise.resolve({
				data: Array.from({ length: 50 }, (_, index) =>
					githubRepositoryResponse(
						page * 100 + index,
						`marta/repository-${page}-${index}`
					)
				),
				headers: { link: NEXT_PAGE_LINK },
			})
		)

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 3,
				search: 'missing',
			})
		).toEqual({ repositories: [], nextPage: 7 })
	})

	test('fetches a repository by string GitHub id without numeric coercion', async () => {
		request.mockResolvedValue({
			data: githubRepositoryResponse(123, 'marta/tessera'),
		})

		expect(
			await githubOctokitClient.getRepository({
				accessToken: 'github-token',
				githubId: '9007199254740993',
			})
		).toEqual(repository)
		expect(request).toHaveBeenCalledWith('GET /repositories/{repository_id}', {
			repository_id: '9007199254740993',
		})
	})

	test('falls back to private visibility when GitHub omits visibility', async () => {
		listForAuthenticatedUser.mockResolvedValue({
			data: [
				{
					...githubRepositoryResponse(123, 'marta/tessera'),
					visibility: undefined,
					private: true,
				},
			],
			headers: {},
		})

		expect(
			await githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
			})
		).toEqual({ repositories: [repository], nextPage: undefined })
	})

	test.each([
		['401', { status: 401 }, GitHubImportAuthenticationError],
		['403', { status: 403 }, GitHubImportForbiddenError],
		['unexpected status', { status: 500 }, GitHubImportExternalServiceError],
		[
			'request failure',
			new Error('socket closed'),
			GitHubImportExternalServiceError,
		],
	])('maps a parallel %s rejection', async (_, error, ErrorClass) => {
		listForAuthenticatedUser.mockImplementation(({ page }: { page: number }) =>
			page === 3
				? Promise.reject(error)
				: Promise.resolve({
						data: Array.from({ length: 50 }, (_, index) =>
							githubRepositoryResponse(
								page * 100 + index,
								`marta/repository-${page}-${index}`
							)
						),
						headers: {},
					})
		)

		await expect(
			githubOctokitClient.listRepositories({
				accessToken: 'github-token',
				page: 1,
				search: 'repository',
			})
		).rejects.toBeInstanceOf(ErrorClass)
		expect(listForAuthenticatedUser).toHaveBeenCalledTimes(4)
	})
})
