import { EnvService } from '@config/env'
import { Injectable, type OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'

@Injectable()
export class RedisClient extends Redis implements OnModuleDestroy {
	constructor(envService: EnvService) {
		super(envService.get('REDIS_URL'))
	}

	async onModuleDestroy() {
		await this.quit()
	}
}
