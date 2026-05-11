import { EnvService } from '@config/env'
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'

@Injectable()
export class CacheRedisClient extends Redis implements OnModuleDestroy {
	constructor(envService: EnvService) {
		super(envService.get('REDIS_URL'), {
			db: envService.get('CACHE_REDIS_DB'),
		})
	}

	async onModuleDestroy() {
		await this.quit()
	}
}
