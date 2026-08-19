import {
	GitStorageClient,
	type GitStorageRepositoryChangedFile,
} from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	ParsedListPullRequestViewedFilesInput,
	ParsedSetPullRequestFileViewedInput,
	PullRequestFileView,
	PullRequestViewedFiles,
} from '@repo/contracts'
import type { PullRequestId, RepositoryId, UserId } from '@repo/domain'
import {
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
} from '../domain/pull-request.errors'
import {
	PullRequestFileViewLimitError,
	PullRequestHeadUnresolvedError,
} from '../domain/pull-request-file-view.errors'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import { isMissingGitObjectError } from '../helpers/pull-request-storage-error'
import {
	type PullRequestFileViewRow,
	PullRequestFileViewsRepository,
} from '../infrastructure/pull-request-file-views.repository'
import { PullRequestReviewsRepository } from '../infrastructure/pull-request-reviews.repository'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { PullRequestHeadResolver } from './pull-request-head.resolver'

interface PullRequestFileViewsContext {
	pullRequest: PullRequestReadModel
	repositoryId: RepositoryId
	storagePath: string
	headSha: string
}

// A comparison is capped at 300 files; anything past this is not a reader ticking files off.
const MAX_VIEWED_FILES = 1000

/**
 * Ticks are keyed to the blob pair a file was read at, so a push only takes back
 * the files it touched and a rename carries the tick its content earned.
 */
@Injectable()
export class PullRequestFileViewsService {
	constructor(
		private readonly pullRequestFileViewsRepository: PullRequestFileViewsRepository,
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestReviewsRepository: PullRequestReviewsRepository,
		private readonly pullRequestHeadResolver: PullRequestHeadResolver,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient
	) {}

	async listViewedFiles(
		viewerUserId: UserId,
		input: ParsedListPullRequestViewedFilesInput
	): Promise<PullRequestViewedFiles> {
		const context = await this.getContext(viewerUserId, input)
		const { headSha, pullRequest } = context
		const [files, views, reviewHeadSha] = await Promise.all([
			this.compareFiles(context, getPullRequestComparisonRefs(pullRequest)),
			this.pullRequestFileViewsRepository.listViews({
				pullRequestId: pullRequest.id,
				userId: viewerUserId,
			}),
			this.findLastReviewedHead(pullRequest.id, viewerUserId),
		])

		return {
			headSha,
			paths: toViewedPaths(files, views, headSha),
			changedSinceReviewPaths: await this.listChangedSinceReviewPaths(
				context,
				reviewHeadSha
			),
			reviewHeadSha,
		}
	}

	// A head that moved under the reader costs them nothing: a tick names a file.
	async setFileViewed(
		viewerUserId: UserId,
		input: ParsedSetPullRequestFileViewedInput
	): Promise<PullRequestFileView> {
		const { headSha, pullRequest } = await this.getContext(
			viewerUserId,
			input,
			{ isStaleHeadAllowed: true }
		)
		const scope = {
			pullRequestId: pullRequest.id,
			userId: viewerUserId,
			path: input.path,
			baseBlobId: input.baseBlobId,
			headBlobId: input.headBlobId,
		}

		if (!input.viewed) {
			await this.pullRequestFileViewsRepository.clearViewed(scope)

			return { path: input.path, headSha, viewed: false }
		}

		const result = await this.pullRequestFileViewsRepository.markViewed({
			...scope,
			headSha,
			limit: MAX_VIEWED_FILES,
		})

		if (result === 'limit_reached')
			throw new PullRequestFileViewLimitError({
				pullRequestId: pullRequest.id,
				userId: viewerUserId,
				limit: MAX_VIEWED_FILES,
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
		}: ParsedListPullRequestViewedFilesInput,
		{ isStaleHeadAllowed = false } = {}
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

		if (!isStaleHeadAllowed && headSha !== expectedHeadSha)
			throw new PullRequestStaleComparisonError({
				pullRequestId: pullRequest.id,
				expectedHeadSha,
				headSha,
			})

		return { pullRequest, repositoryId, storagePath, headSha }
	}

	/** Files the head holds that the viewer's last submitted review did not see. */
	private async listChangedSinceReviewPaths(
		context: PullRequestFileViewsContext,
		reviewHeadSha: string | undefined
	): Promise<string[]> {
		if (!reviewHeadSha || reviewHeadSha === context.headSha) return []

		const files = await this.compareFiles(
			context,
			{ baseRef: reviewHeadSha, headRef: context.headSha },
			// A reviewed commit a force-push has since collected leaves no marks.
			{ isMissingObjectTolerated: true }
		)

		return files.map(toChangedFilePath)
	}

	private async findLastReviewedHead(
		pullRequestId: PullRequestId,
		viewerUserId: UserId
	): Promise<string | undefined> {
		const history = await this.pullRequestReviewsRepository.listReviewHistory({
			pullRequestId,
		})

		return history.findLast(
			review =>
				review.state === 'submitted' && review.reviewer.userId === viewerUserId
		)?.headSha
	}

	private async compareFiles(
		{ repositoryId, storagePath }: PullRequestFileViewsContext,
		refs: { baseRef: string; headRef: string },
		{ isMissingObjectTolerated = false } = {}
	): Promise<GitStorageRepositoryChangedFile[]> {
		try {
			const { files } = await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				...refs,
			})

			return files
		} catch (error) {
			if (isMissingObjectTolerated && isMissingGitObjectError(error)) return []

			throw error
		}
	}
}

/** A deleted file has no new path, so its identity is the path it was removed from. */
function toChangedFilePath(file: GitStorageRepositoryChangedFile): string {
	return file.newPath || file.oldPath
}

/**
 * The blob pair as one comparable identity, or nothing for a submodule, which
 * has no blob on either side and can only be keyed to the head it was read at.
 */
function toBlobKey(
	baseBlobId: string | null | undefined,
	headBlobId: string | null | undefined
): string | undefined {
	if (!(baseBlobId || headBlobId)) return undefined

	return `${baseBlobId ?? ''}:${headBlobId ?? ''}`
}

function toViewedPaths(
	files: GitStorageRepositoryChangedFile[],
	views: PullRequestFileViewRow[],
	headSha: string
): string[] {
	const viewedBlobKeys = new Set<string>()
	const viewedPathsAtHead = new Set<string>()

	for (const view of views) {
		const blobKey = toBlobKey(view.baseBlobId, view.headBlobId)

		if (blobKey) viewedBlobKeys.add(blobKey)
		else if (view.headSha === headSha) viewedPathsAtHead.add(view.path)
	}

	return files
		.filter(file => {
			const blobKey = toBlobKey(file.baseBlobId, file.headBlobId)

			return blobKey
				? viewedBlobKeys.has(blobKey)
				: viewedPathsAtHead.has(toChangedFilePath(file))
		})
		.map(toChangedFilePath)
}
