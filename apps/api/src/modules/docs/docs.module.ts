import { Module } from '@nestjs/common'
import { DocsService } from './application/docs.service'
import { DocsController } from './presentation/docs.controller'

@Module({
	controllers: [DocsController],
	providers: [DocsService],
})
export class DocsModule {}
