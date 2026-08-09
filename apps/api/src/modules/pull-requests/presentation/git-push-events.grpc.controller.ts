import {
	GIT_PUSH_EVENTS_SERVICE_NAME,
	type GitPushEventsServiceController,
	type NotifyPushRequest,
	type NotifyPushResponse,
} from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { status } from '@grpc/grpc-js'
import {
	createGitAuthorizationRpcException,
	GitAuthorizationGrpcExceptionFilter,
	InternalGitAuthorizationGuard,
	isGitAuthorizationRpcException,
} from '@modules/repositories'
import { Controller, UseFilters, UseGuards } from '@nestjs/common'
import { GrpcMethod } from '@nestjs/microservices'
import { DomainError } from '~/shared/errors'
import { PullRequestPushEventsService } from '../application/pull-request-push-events.service'

@Controller()
@UseGuards(InternalGitAuthorizationGuard)
@UseFilters(GitAuthorizationGrpcExceptionFilter)
export class GitPushEventsGrpcController
	implements GitPushEventsServiceController
{
	constructor(
		private readonly pullRequestPushEventsService: PullRequestPushEventsService
	) {}

	/**
	 * Acknowledges only once the events are committed, because an acknowledgement
	 * is what lets the Git service delete its spooled copy of the push.
	 */
	@GrpcMethod(GIT_PUSH_EVENTS_SERVICE_NAME, 'notifyPush')
	async notifyPush(request: NotifyPushRequest): Promise<NotifyPushResponse> {
		try {
			await this.pullRequestPushEventsService.record(request)

			return {}
		} catch (error) {
			throw toGitPushEventsGrpcException(error)
		}
	}
}

/**
 * A refused notification is retried forever unless the refusal is permanent, so
 * a malformed one answers `INVALID_ARGUMENT` and everything else stays
 * retryable.
 */
function toGitPushEventsGrpcException(error: unknown) {
	if (isGitAuthorizationRpcException(error)) return error

	if (error instanceof DomainError && error.code === 'BAD_REQUEST')
		return createGitAuthorizationRpcException(
			status.INVALID_ARGUMENT,
			error.message
		)

	return createGitAuthorizationRpcException(status.INTERNAL, 'Internal error')
}
