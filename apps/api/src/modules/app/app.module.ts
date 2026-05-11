import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { QueueModule } from '@config/queue'
import { RedisModule } from '@config/redis'
import { RPCModule } from '@config/rpc'
import { StorageModule } from '@config/storage'
import { AuthModule } from '@modules/auth'
import { DocsModule } from '@modules/docs'
import { HealthModule } from '@modules/health'
import { Module } from '@nestjs/common'

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		RedisModule,
		QueueModule,
		StorageModule,
		RPCModule,
		AuthModule,
		DocsModule,
		HealthModule,
	],
})
export class AppModule {}
