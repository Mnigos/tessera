import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import { GitHubSyncExternalServiceError } from '../domain/github-sync.errors'
import type {
	GitHubRepositoryReconciliation,
	GitHubSyncActor,
	GitHubSyncActorType,
	GitHubSyncPullRequest,
} from './github-sync.client.types'

const GITHUB_PAGE_SIZE = 100
const MERGED_PULL_REQUEST_DETAIL_BATCH_SIZE = 10

const gitHubActorSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	login: z.string().min(1),
	type: z.string().min(1),
	avatar_url: z.url().nullish(),
	html_url: z.url().nullish(),
})

const gitHubRepositorySchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	owner: gitHubActorSchema,
	name: z.string().min(1),
	full_name: z.string().min(1),
	html_url: z.url(),
	clone_url: z.url(),
	default_branch: z.string().min(1),
})

const gitHubPullRequestSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	number: z.number().int().positive(),
	html_url: z.url(),
	title: z.string(),
	body: z.string().nullish(),
	state: z.enum(['open', 'closed']),
	draft: z.boolean().nullish(),
	user: gitHubActorSchema,
	merged_at: z.string().nullish(),
	merged_by: gitHubActorSchema.nullish(),
	merge_commit_sha: z.string().nullish(),
	created_at: z.string(),
	updated_at: z.string(),
	closed_at: z.string().nullish(),
	head: z.object({
		ref: z.string().min(1),
		sha: z.string().min(1),
		repo: z.object({ node_id: z.string().min(1) }).nullish(),
	}),
	base: z.object({
		ref: z.string().min(1),
		sha: z.string().min(1),
		repo: z.object({ node_id: z.string().min(1) }),
	}),
})

type GitHubPullRequestInput = z.infer<typeof gitHubPullRequestSchema>

@Injectable()
export class GitHubSyncClient {
	private readonly logger = new Logger(GitHubSyncClient.name)

	async getRepositoryReconciliation({
		accessToken,
		externalRepositoryId,
	}: {
		accessToken: string
		externalRepositoryId: bigint
	}): Promise<GitHubRepositoryReconciliation> {
		const octokit = new Octokit({ auth: accessToken })

		try {
			const repositoryResponse = await octokit.request(
				'GET /repositories/{repository_id}',
				{ repository_id: externalRepositoryId.toString() }
			)
			const repository = gitHubRepositorySchema.parse(repositoryResponse.data)
			const pullRequests = await octokit.paginate(octokit.rest.pulls.list, {
				owner: repository.owner.login,
				repo: repository.name,
				state: 'all',
				sort: 'updated',
				direction: 'desc',
				per_page: GITHUB_PAGE_SIZE,
			})
			const parsedPullRequests = pullRequests.map(pullRequest =>
				gitHubPullRequestSchema.parse(pullRequest)
			)
			const detailedPullRequests = await this.loadMergedPullRequestDetails({
				octokit,
				owner: repository.owner.login,
				repo: repository.name,
				pullRequests: parsedPullRequests,
			})

			return {
				repository: {
					nodeId: repository.node_id,
					numericId: BigInt(repository.id),
					ownerLogin: repository.owner.login,
					name: repository.name,
					fullName: repository.full_name,
					htmlUrl: repository.html_url,
					cloneUrl: repository.clone_url,
					defaultBranch: repository.default_branch,
				},
				pullRequests: detailedPullRequests.map(toGitHubSyncPullRequest),
			}
		} catch (error) {
			this.logger.warn('GitHub reconciliation request failed')
			throw new GitHubSyncExternalServiceError(
				{ externalRepositoryId: externalRepositoryId.toString() },
				{ cause: error }
			)
		}
	}

	private async loadMergedPullRequestDetails({
		octokit,
		owner,
		pullRequests,
		repo,
	}: {
		octokit: Octokit
		owner: string
		pullRequests: GitHubPullRequestInput[]
		repo: string
	}): Promise<GitHubPullRequestInput[]> {
		const detailedPullRequests = [...pullRequests]
		const mergedIndexes = pullRequests.flatMap((pullRequest, index) =>
			pullRequest.merged_at ? [index] : []
		)

		for (
			let start = 0;
			start < mergedIndexes.length;
			start += MERGED_PULL_REQUEST_DETAIL_BATCH_SIZE
		) {
			const batchIndexes = mergedIndexes.slice(
				start,
				start + MERGED_PULL_REQUEST_DETAIL_BATCH_SIZE
			)
			const responses = await Promise.all(
				batchIndexes.map(index =>
					octokit.rest.pulls.get({
						owner,
						repo,
						pull_number: pullRequests[index]?.number ?? 0,
					})
				)
			)

			for (const [batchIndex, response] of responses.entries()) {
				const pullRequestIndex = batchIndexes[batchIndex]
				if (pullRequestIndex === undefined) continue

				detailedPullRequests[pullRequestIndex] = gitHubPullRequestSchema.parse(
					response.data
				)
			}
		}

		return detailedPullRequests
	}
}

function toGitHubSyncPullRequest(
	pullRequest: GitHubPullRequestInput
): GitHubSyncPullRequest {
	const mergedAt = toOptionalDate(pullRequest.merged_at)
	const closedAt = toOptionalDate(pullRequest.closed_at)

	return {
		nodeId: pullRequest.node_id,
		numericId: BigInt(pullRequest.id),
		number: pullRequest.number,
		htmlUrl: pullRequest.html_url,
		title: pullRequest.title,
		body: pullRequest.body ?? '',
		state: mergedAt ? 'merged' : pullRequest.state,
		draft: pullRequest.draft ?? false,
		author: toGitHubSyncActor(pullRequest.user),
		mergedBy: pullRequest.merged_by
			? toGitHubSyncActor(pullRequest.merged_by)
			: undefined,
		mergeCommitSha: pullRequest.merge_commit_sha ?? undefined,
		sourceBranch: pullRequest.head.ref,
		targetBranch: pullRequest.base.ref,
		headRepositoryNodeId: pullRequest.head.repo?.node_id,
		baseRepositoryNodeId: pullRequest.base.repo.node_id,
		headSha: pullRequest.head.sha,
		baseSha: pullRequest.base.sha,
		createdAt: new Date(pullRequest.created_at),
		updatedAt: new Date(pullRequest.updated_at),
		closedAt,
		mergedAt,
	}
}

function toGitHubSyncActor(
	actor: z.infer<typeof gitHubActorSchema>
): GitHubSyncActor {
	return {
		nodeId: actor.node_id,
		numericId: BigInt(actor.id),
		login: actor.login,
		type: toGitHubSyncActorType(actor.type),
		avatarUrl: actor.avatar_url ?? undefined,
		htmlUrl: actor.html_url ?? undefined,
	}
}

function toGitHubSyncActorType(type: string): GitHubSyncActorType {
	switch (type.toLowerCase()) {
		case 'bot':
			return 'bot'
		case 'organization':
			return 'organization'
		case 'mannequin':
			return 'mannequin'
		default:
			return 'user'
	}
}

function toOptionalDate(value: string | null | undefined): Date | undefined {
	return value ? new Date(value) : undefined
}
