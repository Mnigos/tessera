import { RepositoriesService } from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	ParsedGetPullRequestInput,
	PullRequestActivity,
} from '@repo/contracts'
import type { UserId } from '@repo/domain'
import { PullRequestNotFoundError } from '../domain/pull-request.errors'
import { PullRequestActivityRepository } from '../infrastructure/pull-request-activity.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'

/**
 * The one read a pull request page polls: has anything moved, and nothing else.
 * No diff, no comparison, no Git, no GitHub — which is what makes it pollable.
 */
@Injectable()
export class PullRequestActivityService {
	constructor(
		private readonly repositoriesService: RepositoriesService,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestActivityRepository: PullRequestActivityRepository
	) {}

	async getActivity(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequestActivity> {
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
			throw new PullRequestNotFoundError({ repositoryId, number })

		const [threads, reviewsUpdatedAt, eventsUpdatedAt, pushedHeadSha, mirror] =
			await Promise.all([
				this.pullRequestActivityRepository.readThreadsActivity(pullRequest.id),
				this.pullRequestActivityRepository.readReviewsUpdatedAt(pullRequest.id),
				this.pullRequestActivityRepository.readEventsCreatedAt(pullRequest.id),
				pullRequest.github
					? undefined
					: this.pullRequestActivityRepository.findPushedHeadSha(
							pullRequest.id
						),
				pullRequest.github
					? this.pullRequestActivityRepository.findMirrorActivity(
							pullRequest.id
						)
					: undefined,
			])
		const headSha = resolveHeadSha(pullRequest, pushedHeadSha)

		return {
			...threads,
			headSha,
			reviewsUpdatedAt,
			eventsUpdatedAt,
			checksUpdatedAt:
				await this.pullRequestActivityRepository.readChecksUpdatedAt({
					headSha,
					repositoryId,
				}),
			mirror,
		}
	}
}

/** The newest head Tessera has been told about, without asking Git for it. */
function resolveHeadSha(
	pullRequest: PullRequestReadModel,
	pushedHeadSha?: string
): string {
	if (pullRequest.github) return pullRequest.github.headSha

	if (pullRequest.state === 'merged')
		return (
			pullRequest.mergedHeadSha ?? pushedHeadSha ?? pullRequest.openingHeadSha
		)

	return pushedHeadSha ?? pullRequest.openingHeadSha
}
