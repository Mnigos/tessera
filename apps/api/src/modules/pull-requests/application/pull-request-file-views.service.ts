import { RepositoriesService } from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	ParsedListPullRequestViewedFilesInput,
	ParsedSetPullRequestFileViewedInput,
	PullRequestFileView,
	PullRequestViewedFiles,
} from '@repo/contracts'
import type { PullRequestId, UserId } from '@repo/domain'
import {
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'
import {
	PullRequestFileViewLimitError,
	PullRequestHeadUnresolvedError,
} from '../domain/pull-request-file-view.errors'
import { PullRequestFileViewsRepository } from '../infrastructure/pull-request-file-views.repository'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'
import { PullRequestHeadResolver } from './pull-request-head.resolver'

interface PullRequestFileViewsContext {
	pullRequestId: PullRequestId
	headSha: string
}

// A comparison is capped at 300 files; anything past this is not a reader ticking files off.
const MAX_VIEWED_FILES_PER_HEAD = 1000

// Ticks are kept per head, so a new commit hands the reader the whole diff back.
@Injectable()
export class PullRequestFileViewsService {
	constructor(
		private readonly pullRequestFileViewsRepository: PullRequestFileViewsRepository,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestHeadResolver: PullRequestHeadResolver,
		private readonly repositoriesService: RepositoriesService
	) {}

	async listViewedFiles(
		viewerUserId: UserId,
		input: ParsedListPullRequestViewedFilesInput
	): Promise<PullRequestViewedFiles> {
		const { headSha, pullRequestId } = await this.getContext(
			viewerUserId,
			input
		)
		const paths = await this.pullRequestFileViewsRepository.listPaths({
			pullRequestId,
			userId: viewerUserId,
			headSha,
		})

		return { headSha, paths }
	}

	async setFileViewed(
		viewerUserId: UserId,
		input: ParsedSetPullRequestFileViewedInput
	): Promise<PullRequestFileView> {
		const { headSha, pullRequestId } = await this.getContext(
			viewerUserId,
			input
		)

		const scope = {
			pullRequestId,
			userId: viewerUserId,
			headSha,
			path: input.path,
		}

		if (!input.viewed) {
			await this.pullRequestFileViewsRepository.clearViewed(scope)

			return { path: input.path, headSha, viewed: false }
		}

		const result = await this.pullRequestFileViewsRepository.markViewed({
			...scope,
			limit: MAX_VIEWED_FILES_PER_HEAD,
		})

		if (result === 'limit_reached')
			throw new PullRequestFileViewLimitError({
				pullRequestId,
				userId: viewerUserId,
				limit: MAX_VIEWED_FILES_PER_HEAD,
			})

		return { path: input.path, headSha, viewed: true }
	}

	private async getContext(
		viewerUserId: UserId,
		{
			expectedHeadSha,
			number,
			slug,
			username,
		}: ParsedListPullRequestViewedFilesInput
	): Promise<PullRequestFileViewsContext> {
		const { repositoryId, storagePath } =
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

		const headSha = await this.pullRequestHeadResolver.resolveComparisonHeadSha(
			{
				pullRequest,
				repositoryId,
				storagePath,
			}
		)

		if (!headSha)
			throw new PullRequestHeadUnresolvedError({
				pullRequestId: pullRequest.id,
				expectedHeadSha,
			})

		if (headSha !== expectedHeadSha)
			throw new PullRequestStaleComparisonError({
				pullRequestId: pullRequest.id,
				expectedHeadSha,
				headSha,
			})

		return { pullRequestId: pullRequest.id, headSha }
	}
}
