import { CacheRedisClient } from '@config/redis'
import { Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'
import type { GitHubLoginLookup } from './github-login.client'

const LOGIN_LOOKUP_KEY_PREFIX = 'github:login-exists:v1:'

export const GITHUB_LOGIN_EXISTS_TTL_SECONDS = 24 * 60 * 60
// Short, because somebody registering the login on GitHub in the meantime is
// the case this guard exists to catch.
export const GITHUB_LOGIN_MISSING_TTL_SECONDS = 30 * 60

const cachedLookupSchema = z.discriminatedUnion('exists', [
	z.object({ exists: z.literal(true), id: z.number(), login: z.string() }),
	z.object({ exists: z.literal(false) }),
])

@Injectable()
export class GitHubLoginCacheRepository {
	private readonly logger = new Logger(GitHubLoginCacheRepository.name)

	constructor(private readonly cacheRedis: CacheRedisClient) {}

	// A cache that cannot be read is a miss, not a failure: Redis being down
	// should cost a GitHub request, not an organization.
	async get(handle: string): Promise<GitHubLoginLookup | undefined> {
		const cached = await this.read(toLookupKey(handle))

		return cached ? parseLookup(cached) : undefined
	}

	// Only answers reach this method: the policy never calls it for a failed
	// lookup, so an outage cannot be cached as a result.
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

// A key written by an older build is a miss, not a crash.
function parseLookup(value: string): GitHubLoginLookup | undefined {
	try {
		return cachedLookupSchema.safeParse(JSON.parse(value)).data
	} catch {
		return undefined
	}
}
