import { Injectable, Logger } from '@nestjs/common'
import type { GitHubWebhookDeliveryId } from '@repo/db'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import { GitHubSyncRepository } from '../infrastructure/github-sync.repository'

/**
 * Replays a stored delivery through the ordinary reconciliation path.
 *
 * This is an operator tool with no procedure, no route, and no button. Tessera
 * deliberately has no user-facing synchronization or retry action — the mirror
 * converges on its own — and a replay is for the case where an operator knows a
 * specific delivery was mishandled and wants that target reconciled now.
 *
 * It cannot duplicate anything, because it adds no second projection path: the
 * delivery is re-armed, the repository's sync version advances, and the normal
 * snapshot reconciliation runs under the current authority. Every entity it
 * touches is keyed by a stable provider identity, so reconciling the same
 * delivery twice converges on the same rows.
 */
@Injectable()
export class GitHubSyncReplayService {
	private readonly logger = new Logger(GitHubSyncReplayService.name)

	constructor(
		private readonly gitHubSyncRepository: GitHubSyncRepository,
		private readonly gitHubSyncQueue: GitHubSyncQueue
	) {}

	async replayDelivery(deliveryId: GitHubWebhookDeliveryId): Promise<boolean> {
		const request =
			await this.gitHubSyncRepository.replayWebhookDelivery(deliveryId)

		if (!request) {
			this.logger.warn(
				`GitHub delivery ${deliveryId} cannot be replayed under the current authority`
			)

			return false
		}

		await this.gitHubSyncQueue.enqueue(request)
		this.logger.log(
			`Replayed GitHub delivery ${deliveryId} as sync version ${request.requestedSyncVersion}`
		)

		return true
	}
}
