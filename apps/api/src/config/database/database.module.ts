import { Global, Module } from '@nestjs/common'
import { db } from '@repo/db/client'
import { Database } from './database'

@Global()
@Module({
	providers: [{ provide: Database, useValue: db }],
	exports: [Database],
})
export class DatabaseModule {}
