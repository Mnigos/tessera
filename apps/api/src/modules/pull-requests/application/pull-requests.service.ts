import { GitStorageClient } from '@config/git-storage'
import { RepositoriesService } from '@modules/repositories'
import { Injectable } from '@nestjs/common'
import type {
	ParsedCreatePullRequestInput,
	ParsedEditPullRequestInput,
	ParsedGetPullRequestInput,
	ParsedListPullRequestsInput,
	PullRequest,
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
	PullRequestNoChangesError,
	PullRequestNotFoundError,
	PullRequestStateConflictError,
} from '../domain/pull-request.errors'
import { PullRequestsRepository } from '../infrastructure/pull-requests.repository'

const OPEN_BRANCH_PAIR_UNIQUE_CONSTRAINT = new Set([
	'pull_requests_open_branch_pair_unique',
])

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

			return toPullRequestOutput(pullRequest)
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

		return pullRequests.map(toPullRequestOutput)
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
			pullRequest: toPullRequestOutput(pullRequest),
			events: events.map(toPullRequestEventOutput),
		}
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
			this.requireUpdatedPullRequest(updatedPullRequest, pullRequest, 'edit')
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

		const closedPullRequest = await this.pullRequestsRepository.close({
			repositoryId,
			pullRequestId: pullRequest.id,
			actorUserId: userId,
			changedAt: new Date(),
		})

		return toPullRequestOutput(
			this.requireUpdatedPullRequest(closedPullRequest, pullRequest, 'close')
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
				)
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
