import { Module } from '@nestjs/common'
import { ChecksEvaluationService } from './application/checks-evaluation.service'
import { ChecksProjectionService } from './application/checks-projection.service'
import { ChecksPublishService } from './application/checks-publish.service'
import { ChecksReadService } from './application/checks-read.service'
import { ChecksRepository } from './infrastructure/checks.repository'

/**
 * The ledger and the ways in and out of it. It depends on nothing else so that
 * every module holding results — repositories, pull requests, the GitHub
 * synchronizer, external publishing — can read from it without any of them
 * having to depend on each other.
 */
@Module({
	providers: [
		ChecksRepository,
		ChecksReadService,
		ChecksEvaluationService,
		ChecksProjectionService,
		ChecksPublishService,
	],
	exports: [
		ChecksReadService,
		ChecksEvaluationService,
		ChecksProjectionService,
		ChecksPublishService,
	],
})
export class ChecksModule {}
