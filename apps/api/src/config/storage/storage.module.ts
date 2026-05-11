import { Global, Module } from '@nestjs/common'
import { storage } from '@repo/storage'

import { Storage } from './storage'

@Global()
@Module({
	providers: [{ provide: Storage, useValue: storage }],
	exports: [Storage],
})
export class StorageModule {}
