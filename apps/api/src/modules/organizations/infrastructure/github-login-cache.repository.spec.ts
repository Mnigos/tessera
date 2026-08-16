import { Logger } from '@nestjs/common'
import {
	GITHUB_LOGIN_EXISTS_TTL_SECONDS,
	GITHUB_LOGIN_MISSING_TTL_SECONDS,
	GitHubLoginCacheRepository,
} from './github-login-cache.repository'

describe(GitHubLoginCacheRepository.name, () => {
	const redis = {
		get: vi.fn(),
		setex: vi.fn(),
	}
	let repository: GitHubLoginCacheRepository

	beforeEach(() => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		redis.get.mockResolvedValue(null)
		redis.setex.mockResolvedValue('OK')
		repository = new GitHubLoginCacheRepository(redis as never)
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('reads a positive and a negative lookup under the handle key', async () => {
		redis.get
			.mockResolvedValueOnce(
				JSON.stringify({ exists: true, id: 42, login: 'TesseraHQ' })
			)
			.mockResolvedValueOnce(JSON.stringify({ exists: false }))

		expect(await repository.get('tesserahq')).toEqual({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
		})
		expect(await repository.get('available')).toEqual({ exists: false })
		expect(redis.get).toHaveBeenNthCalledWith(
			1,
			'github:login-exists:v1:tesserahq'
		)
	})

	test('keys the handle verbatim, leaving normalization to the policy', async () => {
		await repository.get(' TesseraHQ ')
		await repository.set(
			' TesseraHQ ',
			{ exists: false },
			GITHUB_LOGIN_MISSING_TTL_SECONDS
		)

		expect(redis.get).toHaveBeenCalledWith('github:login-exists:v1: TesseraHQ ')
		expect(redis.setex).toHaveBeenCalledWith(
			'github:login-exists:v1: TesseraHQ ',
			1800,
			JSON.stringify({ exists: false })
		)
	})

	test('drops the account type an older build cached', async () => {
		redis.get.mockResolvedValue(
			JSON.stringify({
				exists: true,
				id: 42,
				login: 'TesseraHQ',
				type: 'Organization',
			})
		)

		expect(await repository.get('tesserahq')).toEqual({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
		})
	})

	test.each([
		'not-json',
		'{}',
		'{"exists":true,"login":42}',
		'{"exists":true,"id":"42","login":"TesseraHQ"}',
		'{"exists":"false"}',
	])('treats malformed cached value %s as a miss', async value => {
		redis.get.mockResolvedValue(value)

		expect(await repository.get('tessera')).toBeUndefined()
	})

	test('stores positive and negative lookups with their policy TTLs', async () => {
		await repository.set(
			'tessera',
			{ exists: true, id: 42, login: 'Tessera' },
			GITHUB_LOGIN_EXISTS_TTL_SECONDS
		)
		await repository.set(
			'available',
			{ exists: false },
			GITHUB_LOGIN_MISSING_TTL_SECONDS
		)

		expect(redis.setex).toHaveBeenNthCalledWith(
			1,
			'github:login-exists:v1:tessera',
			86_400,
			JSON.stringify({ exists: true, id: 42, login: 'Tessera' })
		)
		expect(redis.setex).toHaveBeenNthCalledWith(
			2,
			'github:login-exists:v1:available',
			1800,
			JSON.stringify({ exists: false })
		)
	})

	test('degrades Redis read and write failures to a cache miss', async () => {
		redis.get.mockRejectedValue(new Error('redis down'))
		redis.setex.mockRejectedValue(new Error('redis down'))

		expect(await repository.get('tessera')).toBeUndefined()
		expect(
			await repository.set(
				'tessera',
				{ exists: false },
				GITHUB_LOGIN_MISSING_TTL_SECONDS
			)
		).toBeUndefined()
	})
})
