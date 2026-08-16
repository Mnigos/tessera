import type { OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'

export abstract class BaseRedisClient extends Redis implements OnModuleDestroy {
	private closing = false

	// Nest may destroy a provider twice; a second QUIT on a closing socket rejects.
	async onModuleDestroy() {
		if (this.closing) return

		this.closing = true
		await this.quit()
	}
}
