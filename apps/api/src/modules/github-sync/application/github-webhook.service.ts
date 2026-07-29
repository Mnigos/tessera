import { EnvService } from '@config/env'
import { Injectable } from '@nestjs/common'
import type { GitHubWebhookDeliveryId } from '@repo/db'
import { BadRequestError, UnauthorizedError } from '~/shared/errors'
import {
	type GitHubWebhookActor,
	parseGitHubWebhookPayload,
} from '../domain/github-webhook.schema'
import { verifyGitHubWebhookSignature } from '../helpers/github-webhook-signature'
import type {
	GitHubSyncActor,
	GitHubSyncActorType,
} from '../infrastructure/github-sync.client.types'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import { GitHubSyncRepository } from '../infrastructure/github-sync.repository'

@Injectable()
export class GitHubWebhookService {
	constructor(
		private readonly envService: EnvService,
		private readonly githubSyncRepository: GitHubSyncRepository,
		private readonly githubSyncQueue: GitHubSyncQueue
	) {}

	async receive({
		deliveryId,
		eventName,
		rawBody,
		signature,
	}: {
		deliveryId: GitHubWebhookDeliveryId
		eventName: string
		rawBody: Buffer
		signature: string
	}): Promise<{ accepted: true; duplicate: boolean }> {
		const secret = this.envService.get('GITHUB_WEBHOOK_SECRET')

		if (!secret)
			throw new BadRequestError(
				'github webhook',
				{ reason: 'missing_webhook_secret' },
				'GitHub webhook handling is not configured'
			)

		if (!verifyGitHubWebhookSignature({ rawBody, secret, signature }))
			throw new UnauthorizedError('github webhook signature')

		const payload = parseGitHubWebhookPayload(rawBody)
		const targetActor = payload.assignee ?? payload.requested_reviewer
		const result = await this.githubSyncRepository.recordWebhookDelivery({
			deliveryId,
			eventName,
			action: payload.action,
			installation: payload.installation
				? {
						externalInstallationId: BigInt(payload.installation.id),
						accountNodeId: payload.installation.account.node_id,
						accountLogin: payload.installation.account.login,
						targetType:
							(payload.installation.target_type ??
								payload.installation.account.type) === 'Organization'
								? 'organization'
								: 'user',
						suspendedAt:
							payload.action === 'suspended'
								? new Date()
								: payload.action === 'unsuspended'
									? null
									: undefined,
					}
				: undefined,
			externalRepositoryNodeId: payload.repository?.node_id,
			externalRepositoryNumericId: payload.repository
				? BigInt(payload.repository.id)
				: undefined,
			subjectNodeId: payload.pull_request?.node_id,
			subjectNumber: payload.pull_request?.number,
			sender: payload.sender ? toGitHubSyncActor(payload.sender) : undefined,
			targetActor: targetActor ? toGitHubSyncActor(targetActor) : undefined,
			labelNodeId: payload.label?.node_id,
			labelName: payload.label?.name,
			addedInstallationRepositories:
				payload.repositories_added ?? payload.repositories,
			removedInstallationRepositories: payload.repositories_removed,
		})

		await Promise.all(
			result.syncRequests.map(request => this.githubSyncQueue.enqueue(request))
		)

		return { accepted: true, duplicate: result.duplicate }
	}
}

function toGitHubSyncActor(actor: GitHubWebhookActor): GitHubSyncActor {
	return {
		nodeId: actor.node_id,
		numericId: BigInt(actor.id),
		login: actor.login,
		type: toGitHubSyncActorType(actor.type),
		avatarUrl: actor.avatar_url,
		htmlUrl: actor.html_url,
	}
}

function toGitHubSyncActorType(
	type: GitHubWebhookActor['type']
): GitHubSyncActorType {
	switch (type) {
		case 'Bot':
			return 'bot'
		case 'Organization':
			return 'organization'
		case 'Mannequin':
			return 'mannequin'
		default:
			return 'user'
	}
}
