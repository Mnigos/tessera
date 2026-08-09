import { contract } from '@config/rpc'
import { ChecksPublishService } from '@modules/checks'
import { Controller, Req, UseGuards } from '@nestjs/common'
import { Implement, implement } from '@orpc/nest'
import type { AppRequest } from '~/shared/types/app-request'
import { getCheckStatusAuthorization } from './check-status-authorization.context'
import { CheckStatusPublishGuard } from './check-status-publish.guard'

/**
 * The one route a machine reaches. It carries no session and no `RequireAuth`:
 * the credential in the request is the whole identity, and the guard is what
 * turns it into permission to write to exactly one repository.
 */
@Controller()
@UseGuards(CheckStatusPublishGuard)
export class CheckStatusesController {
	constructor(private readonly checksPublishService: ChecksPublishService) {}

	@Implement(contract.checks.publishStatus)
	publishStatus(@Req() request: AppRequest) {
		return implement(contract.checks.publishStatus).handler(({ input }) =>
			this.checksPublishService.publishStatus(
				getCheckStatusAuthorization(request),
				input
			)
		)
	}
}
