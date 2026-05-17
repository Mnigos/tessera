import { Module } from '@nestjs/common'
import { SshPublicKeysService } from './application/ssh-public-keys.service'
import { SshPublicKeysRepository } from './infrastructure/ssh-public-keys.repository'
import { SshPublicKeysController } from './presentation/ssh-public-keys.controller'

@Module({
	controllers: [SshPublicKeysController],
	providers: [SshPublicKeysService, SshPublicKeysRepository],
	exports: [SshPublicKeysService],
})
export class SshPublicKeysModule {}
