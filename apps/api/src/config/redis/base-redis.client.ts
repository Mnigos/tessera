import type { OnModuleDestroy } from '@nestjs/common'
import Redis from 'ioredis'

export abstract class BaseRedisClient extends Redis implements OnModuleDestroy {
	private closing = false

	// Nest can destroy a provider twice (app close, then module close); a second
	// QUIT on the closing socket rejects.
	async onModuleDestroy() {
		if (this.closing) return

		this.closing = true
		await this.quit()
	}
}
