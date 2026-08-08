import { randomUUID } from 'node:crypto'
import {
	GitStorageClient,
	type GitStorageRepositoryBlob,
} from '@config/git-storage'
import type { GitHubSyncPullRequest } from '@modules/github-sync/infrastructure/github-sync.client.types'
import type { GitHubPendingPullRequestEvent } from '@modules/github-sync/infrastructure/github-sync.repository'
import { RepositoriesService } from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	ParsedCreatePullRequestInput,
	ParsedEditPullRequestInput,
	ParsedGetPullRequestFileDiffInput,
	ParsedGetPullRequestInput,
	ParsedListPullRequestsInput,
	ParsedMergePullRequestInput,
	PullRequest,
	PullRequestAuthority,
	PullRequestComparison,
	PullRequestFileDiff,
	PullRequestListItem,
	PullRequestReviewSummary,
	RepositoryViewerRole,
} from '@repo/contracts'
import type { GitHubActorId, PullRequest as PullRequestEntity } from '@repo/db'
import type { RepositoryId, UserId } from '@repo/domain'
import { isUniqueViolation } from '~/shared/helpers/database-errors.helper'
import {
	assertPullRequestClosable,
	assertPullRequestEditable,
	assertPullRequestReopenable,
	toPullRequestEventOutput,
	toPullRequestOutput,
} from '../domain/pull-request'
import {
	PullRequestAlreadyOpenError,
	PullRequestInvalidBranchesError,
	PullRequestMergeConflictError,
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestStaleComparisonError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { toPullRequestAuthority } from '../helpers/pull-request-authority'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import { highlightPullRequestDiff } from '../helpers/pull-request-diff-highlighting'
import { toPullRequestStorageError } from '../helpers/pull-request-storage-error'
import {
	type PullRequestReadModel,
	PullRequestsRepository,
} from '../infrastructure/pull-requests.repository'
import { PullRequestReviewsService } from './pull-request-reviews.service'

const OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT = new Set([
	'pull_requests_open_branch_pair_unique',
])
const MERGE_INTENT_LEASE_MS = 60_000
const EMPTY_REVIEW_SUMMARY: PullRequestReviewSummary = {
	requestedCount: 0,
	approvedCount: 0,
	changeRequestCount: 0,
	staleCount: 0,
}

export interface PullRequestMergeActor {
	email: string
	id: UserId
	name: string
}

export interface ListPullRequestsResult {
	pullRequests: PullRequestListItem[]
	authority: PullRequestAuthority
	viewerRole: RepositoryViewerRole
}

interface MergeRepositoryRefsParams {
	actor: PullRequestMergeActor
	attemptId: string
	expectedBaseSha: string
	expectedHeadSha: string
	pullRequest: PullRequestEntity
	repositoryId: RepositoryId
	storagePath: string
}

@Injectable()
export class PullRequestsService {
	constructor(
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly pullRequestReviewsService: PullRequestReviewsService,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient
	) {}

	async reconcileGitHubPullRequests({
		actorIds,
		pendingEvents,
		pullRequests,
		repositoryId,
	}: {
		actorIds: Map<string, GitHubActorId>
		pendingEvents: GitHubPendingPullRequestEvent[]
		pullRequests: GitHubSyncPullRequest[]
		repositoryId: RepositoryId
	}): Promise<void> {
		for (const pullRequest of pullRequests) {
			const authorActorId = actorIds.get(pullRequest.author.nodeId)
			const mergedByActorId = pullRequest.mergedBy
				? actorIds.get(pullRequest.mergedBy.nodeId)
				: undefined

			if (!authorActorId)
				throw new Error('synchronized pull request author mapping is missing')

			await this.pullRequestsRepository.reconcileGitHubPullRequest({
				repositoryId,
				pullRequest,
				authorActorId,
				mergedByActorId,
				pendingEvents: pendingEvents.filter(
					event => event.subjectNumber === pullRequest.number
				),
			})
		}
	}

	async create(
		userId: UserId,
		{
			body,
			slug,
			sourceBranch,
			targetBranch,
			title,
			username,
		}: ParsedCreatePullRequestInput
	): Promise<PullRequest> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const refs = await this.gitStorageClient.listRepositoryRefs({
			repositoryId,
			storagePath,
			trustedGpgKeys: [],
		})
		const sourceRef = refs.branches.find(branch => branch.name === sourceBranch)
		const targetRef = refs.branches.find(branch => branch.name === targetBranch)

		if (!(sourceRef && targetRef))
			throw new PullRequestInvalidBranchesError({
				repositoryId,
				sourceBranch,
				targetBranch,
				missingSourceBranch: !sourceRef,
				missingTargetBranch: !targetRef,
			})

		if (sourceRef.target === targetRef.target)
			throw new PullRequestNoChangesError({
				repositoryId,
				sourceBranch,
				targetBranch,
			})

		try {
			const pullRequest = await this.pullRequestsRepository.create({
				repositoryId,
				authorUserId: userId,
				sourceBranch,
				targetBranch,
				openingBaseSha: targetRef.target,
				openingHeadSha: sourceRef.target,
				title,
				body: body ?? '',
			})

			if (!pullRequest)
				throw new PullRequestNotFoundError({
					repositoryId,
				})

			return toPullRequestOutput(pullRequest, username)
		} catch (error) {
			if (isUniqueViolation(error, OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT))
				throw new PullRequestAlreadyOpenError({
					repositoryId,
					sourceBranch,
					targetBranch,
				})

			throw error
		}
	}

	async list(
		viewerUserId: UserId | undefined,
		{ slug, state, username }: ParsedListPullRequestsInput
	): Promise<ListPullRequestsResult> {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const pullRequests = await this.pullRequestsRepository.list({
			repositoryId,
			state,
		})
		const reviewSummaries =
			await this.pullRequestReviewsService.listReviewSummaries({
				pullRequests,
				repositoryId,
				storagePath,
			})

		return {
			pullRequests: pullRequests.map(pullRequest => ({
				...toPullRequestOutput(pullRequest, username),
				reviewSummary:
					reviewSummaries.get(pullRequest.id) ?? EMPTY_REVIEW_SUMMARY,
			})),
			authority: toPullRequestAuthority(tesseraWritesAllowed),
			viewerRole,
		}
	}

	async get(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	) {
		const { repositoryId, storagePath, tesseraWritesAllowed, viewerRole } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const [events, reviewState] = await Promise.all([
			this.pullRequestsRepository.listEvents({
				pullRequestId: pullRequest.id,
			}),
			this.pullRequestReviewsService.getReviewState({
				pullRequest,
				repositoryId,
				storagePath,
				tesseraWritesAllowed,
				viewerRole,
				viewerUserId,
			}),
		])

		return {
			pullRequest: toPullRequestOutput(pullRequest, username),
			events: events.map(event => toPullRequestEventOutput(event, username)),
			...reviewState,
			authority: toPullRequestAuthority(tesseraWritesAllowed),
			viewerRole,
		}
	}

	async comparison(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequestComparison> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)

		const comparison = await this.gitStorageClient.compareRepositoryRefs({
			repositoryId,
			storagePath,
			baseRef,
			headRef,
		})

		return {
			...comparison,
			commits: comparison.commits.map(commit => ({
				...commit,
				author: commit.author
					? { ...commit.author, date: new Date(commit.author.date) }
					: undefined,
			})),
		}
	}

	async fileDiff(
		viewerUserId: UserId | undefined,
		{
			expectedBaseSha,
			expectedHeadSha,
			number,
			path,
			slug,
			username,
		}: ParsedGetPullRequestFileDiffInput
	): Promise<PullRequestFileDiff> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{ username, slug }
			)
		await this.findPullRequest(repositoryId, number)
		const diff = await this.gitStorageClient.getRepositoryFileDiff({
			repositoryId,
			storagePath,
			baseRef: expectedBaseSha,
			headRef: expectedHeadSha,
			path,
		})
		const [baseBlob, headBlob] = await Promise.all([
			this.getDiffBlob(repositoryId, storagePath, diff.file.baseBlobId),
			this.getDiffBlob(repositoryId, storagePath, diff.file.headBlobId),
		])

		return await highlightPullRequestDiff({ diff, baseBlob, headBlob })
	}

	async edit(
		userId: UserId,
		{ body, number, slug, title, username }: ParsedEditPullRequestInput
	): Promise<PullRequest> {
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestEditable(pullRequest)

		const updatedPullRequest = await this.pullRequestsRepository.edit({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
			expectedState: pullRequest.state,
			title,
			body,
		})

		return toPullRequestOutput(
			this.requireUpdatedPullRequest(updatedPullRequest, pullRequest, 'edit'),
			username
		)
	}

	async close(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequest> {
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestClosable(pullRequest)
		const changedAt = new Date()

		const closedPullRequest = await this.pullRequestsRepository.close({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
			changedAt,
			staleBefore: new Date(changedAt.getTime() - MERGE_INTENT_LEASE_MS),
		})

		return toPullRequestOutput(
			this.requireUpdatedPullRequest(closedPullRequest, pullRequest, 'close'),
			username
		)
	}

	async reopen(
		userId: UserId,
		{ number, slug, username }: ParsedGetPullRequestInput
	): Promise<PullRequest> {
		const { repositoryId } =
			await this.repositoriesService.getWritableRepositoryContext(userId, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)
		assertPullRequestReopenable(pullRequest)

		try {
			const reopenedPullRequest = await this.pullRequestsRepository.reopen({
				repositoryId,
				pullRequestId: pullRequest.id,
				actorUserId: userId,
				changedAt: new Date(),
			})

			return toPullRequestOutput(
				this.requireUpdatedPullRequest(
					reopenedPullRequest,
					pullRequest,
					'reopen'
				),
				username
			)
		} catch (error) {
			if (isUniqueViolation(error, OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT))
				throw new PullRequestAlreadyOpenError({
					repositoryId,
					sourceBranch: pullRequest.sourceBranch,
					targetBranch: pullRequest.targetBranch,
				})

			throw error
		}
	}

	async merge(
		actor: PullRequestMergeActor,
		{
			expectedBaseSha,
			expectedHeadSha,
			number,
			slug,
			username,
		}: ParsedMergePullRequestInput
	): Promise<PullRequest> {
		const { repositoryId, storagePath } =
			await this.repositoriesService.getWritableRepositoryContext(actor.id, {
				username,
				slug,
			})
		const pullRequest = await this.findPullRequest(repositoryId, number)

		if (pullRequest.state === 'merged' && pullRequest.mergeCommitSha)
			return toPullRequestOutput(pullRequest, username)

		if (pullRequest.state !== 'open')
			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: pullRequest.state,
				action: 'merge',
			})

		const attemptId = randomUUID()
		const startedAt = new Date()
		const claimedPullRequest = await this.pullRequestsRepository.claimMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			attemptId,
			startedAt,
			staleBefore: new Date(startedAt.getTime() - MERGE_INTENT_LEASE_MS),
		})

		if (!claimedPullRequest) {
			const currentPullRequest = await this.findPullRequest(
				repositoryId,
				number
			)
			if (currentPullRequest.state === 'merged')
				return toPullRequestOutput(currentPullRequest, username)

			throw new PullRequestStateConflictError({
				pullRequestId: pullRequest.id,
				state: currentPullRequest.state,
				action: 'merge',
			})
		}

		const mergeCommitSha = await this.mergeRepositoryRefs({
			actor,
			attemptId,
			expectedBaseSha,
			expectedHeadSha,
			pullRequest,
			repositoryId,
			storagePath,
		})

		const mergedPullRequest = await this.pullRequestsRepository.completeMerge({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: actor.id,
			attemptId,
			changedAt: new Date(),
			mergeCommitSha,
		})

		if (mergedPullRequest)
			return toPullRequestOutput(mergedPullRequest, username)

		const currentPullRequest = await this.findPullRequest(repositoryId, number)
		if (currentPullRequest.state === 'merged')
			return toPullRequestOutput(currentPullRequest, username)

		return toPullRequestOutput(
			this.requireUpdatedPullRequest(mergedPullRequest, pullRequest, 'merge'),
			username
		)
	}

	private async mergeRepositoryRefs({
		actor,
		attemptId,
		expectedBaseSha,
		expectedHeadSha,
		pullRequest,
		repositoryId,
		storagePath,
	}: MergeRepositoryRefsParams): Promise<string> {
		try {
			return await this.gitStorageClient.mergeRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef: pullRequest.targetBranch,
				headRef: pullRequest.sourceBranch,
				expectedBaseSha,
				expectedHeadSha,
				authorName: actor.name,
				authorEmail: actor.email,
				message: `Merge pull request #${pullRequest.number}: ${pullRequest.title}`,
				operationId: pullRequest.id,
			})
		} catch (error) {
			const storageError = toPullRequestStorageError(error, {
				repositoryId,
				number: pullRequest.number,
			})
			if (
				storageError instanceof PullRequestMergeConflictError ||
				storageError instanceof PullRequestStaleComparisonError
			)
				await this.pullRequestsRepository.releaseMerge({
					repositoryId,
					pullRequestId: pullRequest.id,
					actorUserId: actor.id,
					attemptId,
				})

			throw storageError
		}
	}

	private async getDiffBlob(
		repositoryId: RepositoryId,
		storagePath: string,
		objectId: string | undefined
	): Promise<GitStorageRepositoryBlob | undefined> {
		if (!objectId) return undefined

		return await this.gitStorageClient.getRepositoryBlob({
			repositoryId,
			storagePath,
			objectId,
		})
	}

	private async findPullRequest(
		repositoryId: RepositoryId,
		number: number
	): Promise<PullRequestReadModel> {
		const pullRequest = await this.pullRequestsRepository.find({
			repositoryId,
			number,
		})

		if (!pullRequest)
			throw new PullRequestNotFoundError({ repositoryId, number })

		return pullRequest
	}

	private requireUpdatedPullRequest(
		updatedPullRequest: PullRequestEntity | undefined,
		originalPullRequest: PullRequestEntity,
		action: string
	): PullRequestEntity {
		if (updatedPullRequest) return updatedPullRequest

		throw new PullRequestStateConflictError({
			pullRequestId: originalPullRequest.id,
			state: originalPullRequest.state,
			action,
		})
	}
}
