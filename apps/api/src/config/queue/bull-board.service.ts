import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'

@Injectable()
export class BullBoardService implements OnModuleInit {
	private readonly logger = new Logger(BullBoardService.name)

	onModuleInit() {
		this.logger.log('Bull Board is ready for queues once background jobs exist')
	}
}
