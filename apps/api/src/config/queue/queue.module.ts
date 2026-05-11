import { EnvModule, EnvService } from '@config/env'
import { BullModule } from '@nestjs/bullmq'
import { Global, Module } from '@nestjs/common'
import { BullBoardService } from './bull-board.service'

@Global()
@Module({
	imports: [
		BullModule.forRootAsync({
			imports: [EnvModule],
			inject: [EnvService],
			useFactory: (envService: EnvService) => ({
				connection: { url: envService.get('REDIS_URL') },
				defaultJobOptions: {
					attempts: 3,
					backoff: { type: 'exponential', delay: 2000 },
					removeOnComplete: { count: 100 },
					removeOnFail: { count: 200 },
				},
			}),
		}),
	],
	providers: [BullBoardService],
})
export class QueueModule {}
