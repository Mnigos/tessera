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

	private closing = false

	async onModuleDestroy() {
		// Nest may destroy the provider more than once (application close
		// followed by module close). ioredis only reflects a quit in `status`
		// once the socket closes, so a second QUIT would fail on the dying
		// connection with "Connection is closed".
		if (this.closing) return

		this.closing = true
		await this.quit()
	}
}
