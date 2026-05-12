import { DatabaseModule } from '@config/database'
import { EnvModule } from '@config/env'
import { GitStorageModule } from '@config/git-storage'
import { QueueModule } from '@config/queue'
import { RedisModule } from '@config/redis'
import { GlobalExceptionFilter, RPCModule } from '@config/rpc'
import { StorageModule } from '@config/storage'
import { AuthModule } from '@modules/auth'
import { DocsModule } from '@modules/docs'
import { HealthModule } from '@modules/health'
import { RepositoriesModule } from '@modules/repositories'
import { UserModule } from '@modules/user'
import { Module } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

@Module({
	imports: [
		EnvModule,
		DatabaseModule,
		GitStorageModule,
		RedisModule,
		QueueModule,
		StorageModule,
		RPCModule,
		AuthModule,
		UserModule,
		RepositoriesModule,
		DocsModule,
		HealthModule,
	],
	providers: [
		{
			provide: APP_FILTER,
			useClass: GlobalExceptionFilter,
		},
	],
})
export class AppModule {}
