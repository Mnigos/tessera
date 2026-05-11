import type { EnvService } from '@config/env'
import Redis from 'ioredis'
import { RedisClient } from './redis.client'

vi.mock('ioredis', () => {
	const RedisMock = vi.fn()
	RedisMock.prototype.quit = vi.fn().mockResolvedValue('OK')

	return { default: RedisMock }
})

describe('RedisClient', () => {
	const mockEnvService = {
		get: vi.fn((key: string) => {
			if (key === 'REDIS_URL') return 'redis://localhost:6379'
		}),
	} as unknown as EnvService

	afterEach(() => {
		vi.clearAllMocks()
	})

	test('should initialize Redis with REDIS_URL', () => {
		const redisClient = new RedisClient(mockEnvService)

		expect(redisClient).toBeDefined()
		expect(Redis).toHaveBeenCalledWith('redis://localhost:6379')
	})

	test('should close redis connection on module destroy', async () => {
		const redisClient = new RedisClient(mockEnvService)

		await redisClient.onModuleDestroy()

		expect(Redis.prototype.quit).toHaveBeenCalledOnce()
	})
})
