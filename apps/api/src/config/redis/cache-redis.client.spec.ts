import type { EnvService } from '@config/env'
import Redis from 'ioredis'
import { CacheRedisClient } from './cache-redis.client'

vi.mock('ioredis', () => {
	const RedisMock = vi.fn()
	RedisMock.prototype.quit = vi.fn().mockResolvedValue('OK')

	return { default: RedisMock }
})

describe('CacheRedisClient', () => {
	const mockEnvService = {
		get: vi.fn((key: string) => {
			if (key === 'REDIS_URL') return 'redis://localhost:6379'
			if (key === 'CACHE_REDIS_DB') return 1
		}),
	} as unknown as EnvService

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('should initialize Redis with cache db override', () => {
		const cacheRedisClient = new CacheRedisClient(mockEnvService)

		expect(cacheRedisClient).toBeDefined()
		expect(Redis).toHaveBeenCalledWith('redis://localhost:6379', {
			db: 1,
		})
	})

	test('should close cache redis connection on module destroy', async () => {
		const cacheRedisClient = new CacheRedisClient(mockEnvService)

		await cacheRedisClient.onModuleDestroy()

		expect(Redis.prototype.quit).toHaveBeenCalledOnce()
	})
})
