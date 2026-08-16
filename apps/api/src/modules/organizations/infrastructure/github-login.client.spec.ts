import { Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { GitHubLookupUnavailableError } from '../domain/organization.errors'
import { GitHubLoginClient } from './github-login.client'

vi.mock('@octokit/rest', () => ({ Octokit: vi.fn() }))

describe(GitHubLoginClient.name, () => {
	let client: GitHubLoginClient
	let request: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		request = vi.fn()
		vi.mocked(Octokit).mockImplementation(function MockOctokit() {
			return { request } as unknown as Octokit
		})
		client = new GitHubLoginClient()
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test.each([
		['User', 'User'],
		['Organization', 'Organization'],
		['Bot', 'User'],
	] as const)('maps a GitHub %s login to %s', async (type, expectedType) => {
		request.mockResolvedValue({ data: { id: 42, login: 'TesseraHQ', type } })

		expect(
			await client.lookupLogin('tesserahq', { accessToken: null })
		).toEqual({ exists: true, id: 42, login: 'TesseraHQ', type: expectedType })
		expect(request).toHaveBeenCalledWith(
			'GET /users/{username}',
			expect.objectContaining({
				username: 'tesserahq',
				request: { signal: expect.any(AbortSignal) },
			})
		)
	})

	test('maps a GitHub 404 to an available login', async () => {
		request.mockRejectedValue({ status: 404 })

		expect(
			await client.lookupLogin('available', { accessToken: null })
		).toEqual({ exists: false })
	})

	test.each([
		401, 403, 429, 500,
	])('maps GitHub status %s to lookup unavailable', async status => {
		request.mockRejectedValue({ status })

		await expect(
			client.lookupLogin('tessera', { accessToken: null })
		).rejects.toBeInstanceOf(GitHubLookupUnavailableError)
	})

	test('maps timeouts and transport failures to lookup unavailable', async () => {
		request.mockRejectedValue(new DOMException('timed out', 'TimeoutError'))

		await expect(
			client.lookupLogin('tessera', { accessToken: null })
		).rejects.toBeInstanceOf(GitHubLookupUnavailableError)
	})

	test('retries a rejected stored token without credentials for status 401', async () => {
		request.mockRejectedValueOnce({ status: 401 }).mockResolvedValueOnce({
			data: { id: 42, login: 'Tessera', type: 'User' },
		})

		expect(
			await client.lookupLogin('tessera', { accessToken: 'expired-token' })
		).toMatchObject({ exists: true, id: 42, login: 'Tessera' })
		expect(Octokit).toHaveBeenNthCalledWith(1, { auth: 'expired-token' })
		expect(Octokit).toHaveBeenNthCalledWith(2)
	})

	test('maps an anonymous 404 after a rejected stored token to available', async () => {
		request.mockRejectedValueOnce({ status: 401 }).mockRejectedValueOnce({
			status: 404,
		})

		expect(
			await client.lookupLogin('available', { accessToken: 'expired-token' })
		).toEqual({ exists: false })
		expect(request).toHaveBeenCalledTimes(2)
	})

	test.each([
		429, 500,
	])('fails closed when the anonymous retry returns status %s', async status => {
		request
			.mockRejectedValueOnce({ status: 401 })
			.mockRejectedValueOnce({ status })

		await expect(
			client.lookupLogin('tessera', { accessToken: 'expired-token' })
		).rejects.toBeInstanceOf(GitHubLookupUnavailableError)
		expect(request).toHaveBeenCalledTimes(2)
	})

	test('does not retry a stored token rejected with 403', async () => {
		request.mockRejectedValue({ status: 403 })

		await expect(
			client.lookupLogin('tessera', { accessToken: 'github-token' })
		).rejects.toBeInstanceOf(GitHubLookupUnavailableError)
		expect(request).toHaveBeenCalledOnce()
	})
})
