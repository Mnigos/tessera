import { EnvService } from '@config/env'
import { Injectable } from '@nestjs/common'
import type { GitHubWebhookDeliveryId } from '@repo/db'
import { BadRequestError, UnauthorizedError } from '~/shared/errors'
import {
	type GitHubWebhookActor,
	type GitHubWebhookInstallation,
	type GitHubWebhookPayload,
	type GitHubWebhookTargetResourceKind,
	parseGitHubWebhookPayload,
} from '../domain/github-webhook.schema'
import { verifyGitHubWebhookSignature } from '../helpers/github-webhook-signature'
import type {
	GitHubSyncActor,
	GitHubSyncActorType,
} from '../infrastructure/github-sync.client.types'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import {
	type GitHubInstallationInput,
	GitHubSyncRepository,
} from '../infrastructure/github-sync.repository'

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
		const target = toGitHubWebhookTarget(eventName, payload)
		const result = await this.githubSyncRepository.recordWebhookDelivery({
			deliveryId,
			eventName,
			action: payload.action,
			installation: payload.installation
				? toGitHubInstallationInput(payload.installation, payload.action)
				: undefined,
			externalRepositoryNodeId: payload.repository?.node_id,
			externalRepositoryNumericId: payload.repository
				? BigInt(payload.repository.id)
				: undefined,
			subjectNodeId: payload.pull_request?.node_id,
			subjectNumber: target.pullRequestNumber,
			issueNumber: payload.issue?.number,
			targetResourceKind: target.kind,
			targetResourceNodeId: target.nodeId,
			targetResourceNumericId: target.numericId,
			targetSha: target.sha,
			targetContext: target.context,
			targetTeamNodeId: payload.requested_team?.node_id,
			targetTeamSlug: payload.requested_team?.slug,
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

function toGitHubInstallationInput(
	installation: GitHubWebhookInstallation,
	action?: string
): GitHubInstallationInput {
	const suspendedAt =
		action === 'suspend'
			? (installation.suspended_at ?? new Date())
			: action === 'unsuspend'
				? null
				: undefined
	const reference = {
		externalInstallationId: BigInt(installation.id),
		suspendedAt,
	}

	if (!installation.account) return reference

	return {
		...reference,
		accountNodeId: installation.account.node_id,
		accountLogin: installation.account.login,
		targetType:
			(installation.target_type ?? installation.account.type) === 'Organization'
				? 'organization'
				: 'user',
	}
}

interface GitHubWebhookTarget {
	kind?: GitHubWebhookTargetResourceKind
	nodeId?: string
	numericId?: bigint
	pullRequestNumber?: number
	sha?: string
	context?: string
}

function toGitHubWebhookTarget(
	eventName: string,
	payload: GitHubWebhookPayload
): GitHubWebhookTarget {
	const pullRequestNumber =
		payload.pull_request?.number ??
		(payload.issue?.pull_request ? payload.issue.number : undefined)

	switch (eventName) {
		case 'pull_request':
			return {
				kind: 'pull_request',
				nodeId: payload.pull_request?.node_id,
				pullRequestNumber,
			}
		case 'issue_comment':
			return {
				kind: 'issue_comment',
				nodeId: payload.comment?.node_id,
				numericId: payload.comment ? BigInt(payload.comment.id) : undefined,
				pullRequestNumber,
			}
		case 'pull_request_review_comment':
			return {
				kind: 'review_comment',
				nodeId: payload.comment?.node_id,
				numericId: payload.comment ? BigInt(payload.comment.id) : undefined,
				pullRequestNumber,
			}
		case 'pull_request_review':
			return {
				kind: 'review',
				nodeId: payload.review?.node_id,
				numericId: payload.review ? BigInt(payload.review.id) : undefined,
				pullRequestNumber,
			}
		case 'pull_request_review_thread':
			return {
				kind: 'review_thread',
				nodeId: payload.thread?.node_id,
				pullRequestNumber,
			}
		// Checks report against a commit. The pull requests a check event embeds
		// are hints GitHub itself computes, so the SHA is the only target worth
		// recording: it stays reconcilable when no pull request references it.
		case 'check_run':
			return {
				kind: 'check_run',
				nodeId: payload.check_run?.node_id,
				numericId: payload.check_run ? BigInt(payload.check_run.id) : undefined,
				sha: payload.check_run?.head_sha,
				context: payload.check_run?.name,
			}
		case 'check_suite':
			return {
				kind: 'check_suite',
				nodeId: payload.check_suite?.node_id,
				numericId: payload.check_suite
					? BigInt(payload.check_suite.id)
					: undefined,
				sha: payload.check_suite?.head_sha,
			}
		case 'status':
			return {
				kind: 'commit_status',
				nodeId: payload.node_id,
				numericId: payload.id ? BigInt(payload.id) : undefined,
				sha: payload.sha,
				context: payload.context,
			}
		default:
			return { pullRequestNumber }
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
