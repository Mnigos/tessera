import { PullRequestsRepository } from '@modules/pull-requests/infrastructure/pull-requests.repository'
import { RepositoriesService } from '@modules/repositories'
import { Injectable, Logger } from '@nestjs/common'
import type {
	ParsedGetPullRequestInput,
	PullRequestGitHubRefresh,
} from '@repo/contracts'
import type { PullRequestId, RepositoryId, UserId } from '@repo/domain'
import { NotFoundError } from '~/shared/errors'
import { GitHubSyncQueue } from '../infrastructure/github-sync.queue'
import { GitHubSyncRepository } from '../infrastructure/github-sync.repository'

/** How often one pull request may be refreshed on a reader's say-so. */
const PULL_REQUEST_REFRESH_INTERVAL_MS = 10_000

/**
 * A reader asking GitHub for this conversation now instead of waiting for the
 * next webhook. It adds no projection path of its own — it wakes the ordinary
 * reconciliation — and it is only ever reached by somebody deliberately asking,
 * because a poll per open pull request would exhaust the installation's budget.
 */
@Injectable()
export class GitHubPullRequestRefreshService {
	private readonly logger = new Logger(GitHubPullRequestRefreshService.name)
	private readonly requestedAt = new Map<PullRequestId, number>()

	constructor(
		private readonly gitHubSyncRepository: GitHubSyncRepository,
		private readonly gitHubSyncQueue: GitHubSyncQueue,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly repositoriesService: RepositoriesService
	) {}

	async refresh(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequestGitHubRefresh> {
		const { repositoryId } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.pullRequestsRepository.find({
			repositoryId,
			number,
		})

		if (!pullRequest)
			throw new NotFoundError('pull request', { repositoryId, number })

		return await this.refreshPullRequest({
			pullRequestId: pullRequest.id,
			repositoryId,
		})
	}

	async refreshPullRequest({
		pullRequestId,
		repositoryId,
	}: {
		pullRequestId: PullRequestId
		repositoryId: RepositoryId
	}): Promise<PullRequestGitHubRefresh> {
		const now = Date.now()

		this.forgetElapsed(now)

		const requestedAt = this.requestedAt.get(pullRequestId)

		if (requestedAt !== undefined)
			return {
				status: 'throttled',
				retryAfterSeconds: Math.ceil(
					(PULL_REQUEST_REFRESH_INTERVAL_MS - (now - requestedAt)) / 1000
				),
			}

		const request =
			await this.gitHubSyncRepository.requestPullRequestConversationRefresh({
				pullRequestId,
				repositoryId,
			})

		if (!request) return { status: 'unavailable' }

		this.requestedAt.set(pullRequestId, now)
		await this.gitHubSyncQueue.enqueue(request)
		this.logger.log(
			`Requested a GitHub refresh of pull request ${pullRequestId} as sync version ${request.requestedSyncVersion}`
		)

		return { status: 'queued' }
	}

	private forgetElapsed(now: number): void {
		for (const [pullRequestId, requestedAt] of this.requestedAt)
			if (now - requestedAt >= PULL_REQUEST_REFRESH_INTERVAL_MS)
				this.requestedAt.delete(pullRequestId)
	}
}
