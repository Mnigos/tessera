import type { NotifyPushRequest } from '@config/git-storage/generated/tessera/git/v1/git_authorization'
import { Injectable, Logger } from '@nestjs/common'
import { PullRequestPushNotificationInvalidError } from '../domain/pull-request.errors'
import { pullRequestPushNotificationSchema } from '../domain/pull-request-push.schema'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'

@Injectable()
export class PullRequestPushEventsService {
	private readonly logger = new Logger(PullRequestPushEventsService.name)

	constructor(
		private readonly pullRequestsRepository: PullRequestsRepository
	) {}

	/**
	 * Writes one timeline event per branch movement the Git service reported.
	 * A malformed notification is refused rather than dropped: the sender retries
	 * until it is acknowledged, so only a refusal stops it from retrying forever.
	 */
	async record(notification: NotifyPushRequest): Promise<void> {
		const parsed = pullRequestPushNotificationSchema.safeParse(notification)

		if (!parsed.success)
			throw new PullRequestPushNotificationInvalidError({
				operationId: notification.operationId,
				repositoryId: notification.repositoryId,
			})

		const { actorUserId, occurredAt, operationId, repositoryId, updates } =
			parsed.data
		const createdEvents = await this.pullRequestsRepository.createPushEvents({
			actorUserId,
			occurredAt,
			operationId,
			repositoryId,
			updates,
		})

		this.logger.log(
			`Push ${operationId} on repository ${repositoryId} recorded ${createdEvents} pull request events`
		)
	}
}
