import { EnvService } from '@config/env'
import { Injectable } from '@nestjs/common'
import { BaseRedisClient } from './base-redis.client'

@Injectable()
export class CacheRedisClient extends BaseRedisClient {
	constructor(envService: EnvService) {
		super(envService.get('REDIS_URL'), {
			db: envService.get('CACHE_REDIS_DB'),
		})
	}
}
