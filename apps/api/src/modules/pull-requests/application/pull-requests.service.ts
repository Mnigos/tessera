import { randomUUID } from 'node:crypto'
import {
	GitStorageClient,
	type GitStorageRepositoryBlob,
} from '@config/git-storage'
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
	PullRequestComparison,
	PullRequestFileDiff,
} from '@repo/contracts'
import type { PullRequest as PullRequestEntity } from '@repo/db'
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
import { highlightPullRequestDiff } from '../helpers/pull-request-diff-highlighting'
import { toPullRequestStorageError } from '../helpers/pull-request-storage-error'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'

const OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT = new Set([
	'pull_requests_open_branch_pair_unique',
])
const MERGE_INTENT_LEASE_MS = 60_000

export interface PullRequestMergeActor {
	email: string
	id: UserId
	name: string
}

@Injectable()
export class PullRequestsService {
	constructor(
		private readonly pullRequestsRepository: PullRequestsRepository,
		private readonly repositoriesService: RepositoriesService,
		private readonly gitStorageClient: GitStorageClient
	) {}

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
			await this.repositoriesService.getWritableRepositoryContext({
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
	): Promise<PullRequest[]> {
		const { repositoryId } =
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

		return pullRequests.map(pullRequest =>
			toPullRequestOutput(pullRequest, username)
		)
	}

	async get(
		viewerUserId: UserId | undefined,
		{ number, slug, username }: ParsedGetPullRequestInput
	) {
		const { repositoryId } =
			await this.repositoriesService.getReadableRepositoryContext(
				viewerUserId,
				{
					username,
					slug,
				}
			)
		const pullRequest = await this.findPullRequest(repositoryId, number)
		const events = await this.pullRequestsRepository.listEvents({
			pullRequestId: pullRequest.id,
		})

		return {
			pullRequest: toPullRequestOutput(pullRequest, username),
			events: events.map(toPullRequestEventOutput),
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
		const { baseRef, headRef } = this.getComparisonRefs(pullRequest)

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
			await this.repositoriesService.getWritableRepositoryContext({
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
			await this.repositoriesService.getWritableRepositoryContext({
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
			await this.repositoriesService.getWritableRepositoryContext({
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
			await this.repositoriesService.getWritableRepositoryContext({
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

		let mergeCommitSha: string
		try {
			mergeCommitSha = await this.gitStorageClient.mergeRepositoryRefs({
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
				number,
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

	private getComparisonRefs(pullRequest: PullRequestEntity) {
		if (pullRequest.state === 'merged' && pullRequest.mergeCommitSha)
			return {
				baseRef: `${pullRequest.mergeCommitSha}^1`,
				headRef: `${pullRequest.mergeCommitSha}^2`,
			}

		return {
			baseRef: pullRequest.targetBranch,
			headRef: pullRequest.sourceBranch,
		}
	}

	private async findPullRequest(
		repositoryId: RepositoryId,
		number: number
	): Promise<PullRequestEntity> {
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
