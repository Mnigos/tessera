import { CacheRedisClient } from '@config/redis'
import { Injectable, Logger } from '@nestjs/common'
import type { GitHubLoginLookup } from '../domain/github-login-claim'

const LOGIN_LOOKUP_KEY_PREFIX = 'github:login-exists:v1:'
const LOOKUP_LOCK_KEY_PREFIX = 'github:login-exists-lock:v1:'

export const GITHUB_LOGIN_EXISTS_TTL_SECONDS = 24 * 60 * 60
// Short, because somebody registering the login on GitHub in the meantime is
// the case this guard exists to catch.
export const GITHUB_LOGIN_MISSING_TTL_SECONDS = 30 * 60

const LOOKUP_LOCK_TTL_MS = 10_000
const LOOKUP_POLL_ATTEMPTS = 3
const LOOKUP_POLL_INTERVAL_MS = 250

@Injectable()
export class GitHubLoginCacheRepository {
	private readonly logger = new Logger(GitHubLoginCacheRepository.name)

	// The Redis lock deduplicates across instances; this deduplicates within one.
	private readonly inflightLookups = new Map<
		string,
		Promise<GitHubLoginLookup>
	>()

	constructor(private readonly cacheRedis: CacheRedisClient) {}

	// A cache that cannot be read is a miss, not a failure: Redis being down
	// should cost a GitHub request, not an organization.
	async get(slug: string): Promise<GitHubLoginLookup | undefined> {
		const cached = await this.read(toLookupKey(slug))

		return cached ? parseLookup(cached) : undefined
	}

	// Only answers reach this method: the policy never calls it for a failed
	// lookup, so an outage cannot be cached as a result.
	async set(
		slug: string,
		lookup: GitHubLoginLookup,
		ttlSeconds: number
	): Promise<void> {
		await this.write(toLookupKey(slug), JSON.stringify(lookup), ttlSeconds)
	}

	// Runs a lookup at most once per handle across concurrent callers: the lock
	// winner resolves, loser callers poll the result key, then look up themselves.
	async withDedupe(
		slug: string,
		resolve: () => Promise<GitHubLoginLookup>
	): Promise<GitHubLoginLookup> {
		const handle = normalizeSlug(slug)
		const inflight = this.inflightLookups.get(handle)

		if (inflight) return await inflight

		const lookup = this.resolveOnce(handle, resolve).finally(() => {
			this.inflightLookups.delete(handle)
		})

		this.inflightLookups.set(handle, lookup)

		return await lookup
	}

	private async resolveOnce(
		handle: string,
		resolve: () => Promise<GitHubLoginLookup>
	): Promise<GitHubLoginLookup> {
		if (await this.acquireLookupLock(handle))
			return await this.resolveAsLockHolder(handle, resolve)

		for (let attempt = 0; attempt < LOOKUP_POLL_ATTEMPTS; attempt++) {
			await delay(LOOKUP_POLL_INTERVAL_MS)

			const cached = await this.get(handle)
			if (cached) return cached
		}

		return await resolve()
	}

	// A failed lookup publishes no result, so the lock is handed back rather than
	// left to make every later caller sleep through the poll window first.
	private async resolveAsLockHolder(
		handle: string,
		resolve: () => Promise<GitHubLoginLookup>
	) {
		try {
			return await resolve()
		} catch (error) {
			await this.releaseLookupLock(handle)

			throw error
		}
	}

	private async acquireLookupLock(handle: string) {
		try {
			const result = await this.cacheRedis.set(
				toLookupLockKey(handle),
				'1',
				'PX',
				LOOKUP_LOCK_TTL_MS,
				'NX'
			)

			return result === 'OK'
		} catch (error) {
			this.logger.warn('GitHub login lookup lock is unavailable', error)

			// Without a lock every caller looks the handle up itself, which is the
			// behaviour this deduplication is an optimisation over.
			return true
		}
	}

	private async releaseLookupLock(handle: string) {
		try {
			await this.cacheRedis.del(toLookupLockKey(handle))
		} catch (error) {
			this.logger.warn('GitHub login lookup lock release failed', error)
		}
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

function normalizeSlug(slug: string) {
	return slug.trim().toLowerCase()
}

function toLookupKey(slug: string) {
	return `${LOGIN_LOOKUP_KEY_PREFIX}${normalizeSlug(slug)}`
}

function toLookupLockKey(handle: string) {
	return `${LOOKUP_LOCK_KEY_PREFIX}${normalizeSlug(handle)}`
}

// A key written by an older build is a miss, not a crash.
function parseLookup(value: string): GitHubLoginLookup | undefined {
	try {
		const parsed: unknown = JSON.parse(value)

		if (!parsed || typeof parsed !== 'object' || !('exists' in parsed))
			return undefined

		if (parsed.exists === false) return { exists: false }

		if (
			parsed.exists === true &&
			'id' in parsed &&
			typeof parsed.id === 'number' &&
			'login' in parsed &&
			typeof parsed.login === 'string' &&
			'type' in parsed &&
			(parsed.type === 'User' || parsed.type === 'Organization')
		)
			return {
				exists: true,
				id: parsed.id,
				login: parsed.login,
				type: parsed.type,
			}

		return undefined
	} catch {
		return undefined
	}
}

function delay(milliseconds: number) {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}
