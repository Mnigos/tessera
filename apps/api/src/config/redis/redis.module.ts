import { EnvModule } from '@config/env'
import { Global, Module } from '@nestjs/common'
import { CacheRedisClient } from './cache-redis.client'
import { RedisClient } from './redis.client'

@Global()
@Module({
	imports: [EnvModule],
	providers: [RedisClient, CacheRedisClient],
	exports: [RedisClient, CacheRedisClient],
})
export class RedisModule {}
