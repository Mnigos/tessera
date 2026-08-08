import { Module } from '@nestjs/common'
import { ChecksEvaluationService } from './application/checks-evaluation.service'
import { ChecksProjectionService } from './application/checks-projection.service'
import { ChecksReadService } from './application/checks-read.service'
import { ChecksRepository } from './infrastructure/checks.repository'

@Module({
	providers: [
		ChecksRepository,
		ChecksReadService,
		ChecksEvaluationService,
		ChecksProjectionService,
	],
	exports: [
		ChecksReadService,
		ChecksEvaluationService,
		ChecksProjectionService,
	],
})
export class ChecksModule {}
