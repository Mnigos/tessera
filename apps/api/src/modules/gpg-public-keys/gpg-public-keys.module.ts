import { Module } from '@nestjs/common'
import { GpgPublicKeysService } from './application/gpg-public-keys.service'
import { GpgPublicKeysRepository } from './infrastructure/gpg-public-keys.repository'
import { GpgPublicKeysController } from './presentation/gpg-public-keys.controller'

@Module({
	controllers: [GpgPublicKeysController],
	providers: [GpgPublicKeysService, GpgPublicKeysRepository],
	exports: [GpgPublicKeysService],
})
export class GpgPublicKeysModule {}
