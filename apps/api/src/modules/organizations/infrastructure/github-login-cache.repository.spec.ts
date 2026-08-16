import { Logger } from '@nestjs/common'
import type { GitHubLoginLookup } from '../domain/github-login-claim'
import {
	GITHUB_LOGIN_EXISTS_TTL_SECONDS,
	GITHUB_LOGIN_MISSING_TTL_SECONDS,
	GitHubLoginCacheRepository,
} from './github-login-cache.repository'

describe(GitHubLoginCacheRepository.name, () => {
	const redis = {
		get: vi.fn(),
		set: vi.fn(),
		setex: vi.fn(),
		del: vi.fn(),
	}
	let repository: GitHubLoginCacheRepository

	beforeEach(() => {
		vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
		redis.get.mockResolvedValue(null)
		redis.set.mockResolvedValue('OK')
		redis.setex.mockResolvedValue('OK')
		redis.del.mockResolvedValue(1)
		repository = new GitHubLoginCacheRepository(redis as never)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	test('reads a normalized positive and negative lookup', async () => {
		redis.get
			.mockResolvedValueOnce(
				JSON.stringify({
					exists: true,
					id: 42,
					login: 'TesseraHQ',
					type: 'Organization',
				})
			)
			.mockResolvedValueOnce(JSON.stringify({ exists: false }))

		expect(await repository.get(' TesseraHQ ')).toEqual({
			exists: true,
			id: 42,
			login: 'TesseraHQ',
			type: 'Organization',
		})
		expect(await repository.get('available')).toEqual({ exists: false })
		expect(redis.get).toHaveBeenNthCalledWith(
			1,
			'github:login-exists:v1:tesserahq'
		)
	})

	test.each([
		'not-json',
		'{}',
		'{"exists":true,"login":42}',
	])('treats malformed cached value %s as a miss', async value => {
		redis.get.mockResolvedValue(value)

		expect(await repository.get('tessera')).toBeUndefined()
	})

	test('stores positive and negative lookups with their policy TTLs', async () => {
		await repository.set(
			'tessera',
			{ exists: true, id: 42, login: 'Tessera', type: 'User' },
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
			JSON.stringify({ exists: true, id: 42, login: 'Tessera', type: 'User' })
		)
		expect(redis.setex).toHaveBeenNthCalledWith(
			2,
			'github:login-exists:v1:available',
			1800,
			JSON.stringify({ exists: false })
		)
	})

	test('deduplicates concurrent lookups in this process', async () => {
		const deferred = Promise.withResolvers<GitHubLoginLookup>()
		const resolve = vi.fn(() => deferred.promise)

		const first = repository.withDedupe(' Tessera ', resolve)
		const second = repository.withDedupe('tessera', resolve)

		deferred.resolve({ exists: false })

		expect(await Promise.all([first, second])).toEqual([
			{ exists: false },
			{ exists: false },
		])
		expect(resolve).toHaveBeenCalledOnce()
		expect(redis.set).toHaveBeenCalledOnce()
	})

	test('uses a result published by another distributed lock holder', async () => {
		vi.useFakeTimers()
		redis.set.mockResolvedValue(null)
		redis.get.mockResolvedValue(JSON.stringify({ exists: false }))
		const resolve = vi.fn()

		const lookup = repository.withDedupe('tessera', resolve)
		await vi.runAllTimersAsync()

		expect(await lookup).toEqual({ exists: false })
		expect(resolve).not.toHaveBeenCalled()
		expect(redis.get).toHaveBeenCalledOnce()
	})

	test('resolves after a stale distributed lock publishes nothing', async () => {
		vi.useFakeTimers()
		redis.set.mockResolvedValue(null)
		const resolve = vi.fn().mockResolvedValue({ exists: false })

		const lookup = repository.withDedupe('tessera', resolve)
		await vi.runAllTimersAsync()

		expect(await lookup).toEqual({ exists: false })
		expect(redis.get).toHaveBeenCalledTimes(3)
		expect(resolve).toHaveBeenCalledOnce()
	})

	test('runs immediately when the distributed lock is unavailable', async () => {
		redis.set.mockRejectedValue(new Error('redis down'))
		const error = new Error('GitHub unavailable')
		const resolve = vi.fn().mockRejectedValue(error)

		await expect(repository.withDedupe('tessera', resolve)).rejects.toBe(error)
		expect(resolve).toHaveBeenCalledOnce()
		expect(redis.get).not.toHaveBeenCalled()
		expect(redis.setex).not.toHaveBeenCalled()
	})

	test('releases the distributed lock after a failed lookup', async () => {
		const error = new Error('GitHub unavailable')

		await expect(
			repository.withDedupe('tessera', () => Promise.reject(error))
		).rejects.toBe(error)
		expect(redis.del).toHaveBeenCalledWith(
			'github:login-exists-lock:v1:tessera'
		)
		expect(redis.setex).not.toHaveBeenCalled()
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
