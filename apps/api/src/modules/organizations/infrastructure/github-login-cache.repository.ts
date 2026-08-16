import { CacheRedisClient } from '@config/redis'
import { Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'
import type { GitHubLoginLookup } from './github-login.client'

const LOGIN_LOOKUP_KEY_PREFIX = 'github:login-exists:v1:'

export const GITHUB_LOGIN_EXISTS_TTL_SECONDS = 24 * 60 * 60
export const GITHUB_LOGIN_MISSING_TTL_SECONDS = 30 * 60

const cachedLookupSchema = z.discriminatedUnion('exists', [
	z.object({ exists: z.literal(true), id: z.number(), login: z.string() }),
	z.object({ exists: z.literal(false) }),
])

@Injectable()
export class GitHubLoginCacheRepository {
	private readonly logger = new Logger(GitHubLoginCacheRepository.name)

	constructor(private readonly cacheRedis: CacheRedisClient) {}

	// Redis failures degrade to a miss.
	async get(handle: string): Promise<GitHubLoginLookup | undefined> {
		const cached = await this.read(toLookupKey(handle))

		return cached ? parseLookup(cached) : undefined
	}

	async set(
		handle: string,
		lookup: GitHubLoginLookup,
		ttlSeconds: number
	): Promise<void> {
		await this.write(toLookupKey(handle), JSON.stringify(lookup), ttlSeconds)
	}

	private async read(key: string) {
		try {
			return await this.cacheRedis.get(key)
		} catch (error) {
			this.logger.warn('GitHub login cache read failed', error)

			return null
		}
	}

	private async write(key: string, value: string, ttlSeconds: number) {
		try {
			await this.cacheRedis.setex(key, ttlSeconds, value)
		} catch (error) {
			this.logger.warn('GitHub login cache write failed', error)
		}
	}
}

function toLookupKey(handle: string) {
	return `${LOGIN_LOOKUP_KEY_PREFIX}${handle}`
}

function parseLookup(value: string): GitHubLoginLookup | undefined {
	try {
		return cachedLookupSchema.safeParse(JSON.parse(value)).data
	} catch {
		return undefined
	}
}
