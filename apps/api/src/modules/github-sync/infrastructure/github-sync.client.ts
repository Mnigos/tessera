import { Injectable, Logger } from '@nestjs/common'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import { GitHubSyncExternalServiceError } from '../domain/github-sync.errors'
import {
	classifyGitHubSyncFailure,
	type GitHubSyncRequestScope,
} from '../domain/github-sync-failure'
import {
	type GitHubRestPullRequest,
	gitHubActorSchema,
	gitHubDiffSideSchema,
	gitHubIssueCommentSchema,
	gitHubPullRequestSchema,
	gitHubReviewCommentSchema,
	gitHubReviewSchema,
	toGitHubSyncActor,
	toGitHubSyncActorType,
	toGitHubSyncDiffSide,
	toGitHubSyncIssueComment,
	toGitHubSyncPullRequest,
	toGitHubSyncReview,
	toGitHubSyncReviewComment,
	toOptionalDate,
} from './github-rest.mappers'
import type {
	GitHubChecksRequestScope,
	GitHubChecksSnapshot,
	GitHubPullRequestConversation,
	GitHubRepositoryReconciliation,
	GitHubSyncActor,
	GitHubSyncCheckApp,
	GitHubSyncCheckRun,
	GitHubSyncCheckSuite,
	GitHubSyncCommitStatus,
	GitHubSyncIssueComment,
	GitHubSyncRateLimit,
	GitHubSyncReview,
	GitHubSyncReviewComment,
	GitHubSyncReviewerRequestTarget,
	GitHubSyncReviewThread,
} from './github-sync.client.types'

const GITHUB_PAGE_SIZE = 100
const MERGED_PULL_REQUEST_DETAIL_BATCH_SIZE = 10
const DIFF_STATS_ALIAS_PREFIX = 'pr'
const GITHUB_CURSOR_FALLBACK_OVERLAP_MS = 60_000

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

const gitHubRequestedReviewersSchema = z.object({
	users: z.array(gitHubActorSchema).nullish(),
	teams: z
		.array(
			z.object({
				id: z.number().int().positive(),
				node_id: z.string().min(1),
				slug: z.string().min(1),
				name: z.string().min(1),
				html_url: z.url().nullish(),
			})
		)
		.nullish(),
})

/**
 * A provider link Tessera only ever renders. GitHub allows values its own API
 * will not round-trip as URLs, and one malformed link must not fail the whole
 * commit's reconciliation.
 */
const gitHubOptionalLinkSchema = z.url().nullish().catch(undefined)

const gitHubCheckAppSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	slug: z.string().min(1).nullish(),
	name: z.string().min(1).nullish(),
	html_url: gitHubOptionalLinkSchema,
})

const gitHubCheckSuiteSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	head_sha: z.string().min(1),
	status: z.string().min(1).nullish(),
	conclusion: z.string().min(1).nullish(),
	app: gitHubCheckAppSchema.nullish(),
	created_at: z.string().nullish(),
	updated_at: z.string().nullish(),
})

const gitHubCheckRunSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	head_sha: z.string().min(1),
	name: z.string().min(1),
	status: z.string().min(1).nullish(),
	conclusion: z.string().min(1).nullish(),
	external_id: z.string().nullish(),
	details_url: gitHubOptionalLinkSchema,
	html_url: gitHubOptionalLinkSchema,
	output: z
		.object({
			title: z.string().nullish(),
			summary: z.string().nullish(),
		})
		.nullish(),
	check_suite: z
		.object({
			id: z.number().int().positive(),
			node_id: z.string().min(1).nullish(),
		})
		.nullish(),
	app: gitHubCheckAppSchema.nullish(),
	started_at: z.string().nullish(),
	completed_at: z.string().nullish(),
})

const gitHubCommitStatusSchema = z.object({
	id: z.number().int().positive(),
	node_id: z.string().min(1),
	context: z.string().min(1),
	state: z.string().min(1),
	target_url: gitHubOptionalLinkSchema,
	description: z.string().nullish(),
	creator: gitHubActorSchema.nullish(),
	created_at: z.string(),
	updated_at: z.string(),
})

const gitHubGraphQlActorSchema = z.object({
	__typename: z.string().min(1),
	id: z.string().min(1).nullish(),
	databaseId: z.number().int().positive().nullish(),
	login: z.string().min(1),
	avatarUrl: z.url().nullish(),
	url: z.url().nullish(),
})

const gitHubGraphQlReviewThreadSchema = z.object({
	id: z.string().min(1),
	isResolved: z.boolean(),
	isOutdated: z.boolean(),
	subjectType: z.enum(['LINE', 'FILE']),
	path: z.string().min(1).nullish(),
	line: z.number().int().nullish(),
	diffSide: gitHubDiffSideSchema.nullish(),
	resolvedBy: gitHubGraphQlActorSchema.nullish(),
	comments: z.object({
		nodes: z
			.array(
				z
					.object({
						id: z.string().min(1),
						replyTo: z.object({ id: z.string().min(1) }).nullish(),
						originalCommit: z.object({ oid: z.string().min(1) }).nullish(),
					})
					.nullish()
			)
			.nullish(),
	}),
})

const gitHubReviewThreadsResponseSchema = z.object({
	repository: z
		.object({
			pullRequest: z
				.object({
					reviewThreads: z.object({
						pageInfo: z.object({
							hasNextPage: z.boolean(),
							endCursor: z.string().nullish(),
						}),
						nodes: z.array(gitHubGraphQlReviewThreadSchema.nullish()).nullish(),
					}),
				})
				.nullish(),
		})
		.nullish(),
})

/**
 * Thread comments are capped at one page; REST review comments carry
 * `in_reply_to_id` for the remainder of a thread longer than that.
 */
const REVIEW_THREADS_QUERY = `
	query PullRequestReviewThreads(
		$owner: String!
		$name: String!
		$number: Int!
		$cursor: String
	) {
		repository(owner: $owner, name: $name) {
			pullRequest(number: $number) {
				reviewThreads(first: ${GITHUB_PAGE_SIZE}, after: $cursor) {
					pageInfo {
						hasNextPage
						endCursor
					}
					nodes {
						id
						isResolved
						isOutdated
						subjectType
						path
						line
						diffSide
						resolvedBy {
							__typename
							id
							databaseId
							login
							avatarUrl
							url
						}
						comments(first: ${GITHUB_PAGE_SIZE}) {
							nodes {
								id
								replyTo {
									id
								}
								originalCommit {
									oid
								}
							}
						}
					}
				}
			}
		}
	}
`

const GITHUB_MERGEABLE_STATES = {
	CONFLICTING: 'conflicting',
	MERGEABLE: 'mergeable',
	UNKNOWN: 'unknown',
} as const

const gitHubGraphQlDiffStatsSchema = z
	.object({
		additions: z.number().int().nonnegative(),
		deletions: z.number().int().nonnegative(),
		changedFiles: z.number().int().nonnegative(),
		mergeable: z.enum(['CONFLICTING', 'MERGEABLE', 'UNKNOWN']),
		commits: z.object({ totalCount: z.number().int().nonnegative() }),
	})
	.transform(({ commits, mergeable, ...stats }) => ({
		...stats,
		commitCount: commits.totalCount,
		mergeableState: GITHUB_MERGEABLE_STATES[mergeable],
	}))

const gitHubDiffStatsResponseSchema = z.object({
	repository: z
		.record(z.string(), gitHubGraphQlDiffStatsSchema.nullish())
		.nullish(),
})

/** `pulls.list` omits the totals, so one aliased query stands in for a read per pull request. */
function buildDiffStatsQuery(numbers: number[]): string {
	const fields = numbers
		.map(
			number =>
				`${DIFF_STATS_ALIAS_PREFIX}${number}: pullRequest(number: ${number}) { additions deletions changedFiles mergeable commits { totalCount } }`
		)
		.join('\n\t\t\t')

	return `
	query PullRequestDiffStats($owner: String!, $name: String!) {
		repository(owner: $owner, name: $name) {
			${fields}
		}
	}
`
}

@Injectable()
export class GitHubSyncClient {
	private readonly logger = new Logger(GitHubSyncClient.name)

	/**
	 * An Octokit that reports what the installation's budget looked like across
	 * every response it made, not just the one the caller happened to read
	 * headers from. Rate limits are counted per installation, so a paginated
	 * listing deep inside a conversation read is as good a warning as any — and
	 * the tightest budget seen is the one worth keeping, because it is the one
	 * the next repository under this installation will run into.
	 */
	private createOctokit(accessToken: string): {
		octokit: Octokit
		readRateLimit: () => GitHubSyncRateLimit | undefined
	} {
		const octokit = new Octokit({ auth: accessToken })
		let rateLimit: GitHubSyncRateLimit | undefined

		octokit.hook.after('request', response => {
			const observed = toGitHubSyncRateLimit(response.headers)

			if (!observed) return
			if (
				rateLimit?.remaining !== undefined &&
				observed.remaining !== undefined &&
				observed.remaining > rateLimit.remaining
			)
				return

			rateLimit = observed
		})

		return { octokit, readRateLimit: () => rateLimit }
	}

	async getRepositoryReconciliation({
		accessToken,
		externalRepositoryId,
		updatedAfter,
	}: {
		accessToken: string
		externalRepositoryId: bigint
		updatedAfter?: Date
	}): Promise<GitHubRepositoryReconciliation> {
		const { octokit, readRateLimit } = this.createOctokit(accessToken)

		try {
			const repositoryResponse = await octokit.request(
				'GET /repositories/{repository_id}',
				{ repository_id: externalRepositoryId.toString() }
			)
			const pullRequestCursorAt = getPullRequestCursorAt(
				repositoryResponse.headers.date
			)
			const repository = gitHubRepositorySchema.parse(repositoryResponse.data)
			const pullRequests = await octokit.paginate(
				octokit.rest.pulls.list,
				{
					owner: repository.owner.login,
					repo: repository.name,
					state: 'all',
					sort: 'updated',
					direction: 'desc',
					per_page: GITHUB_PAGE_SIZE,
				},
				(response, done) => {
					if (!updatedAfter) return response.data

					const updatedPullRequests = response.data.filter(pullRequest => {
						const updatedAt = Date.parse(pullRequest.updated_at)

						return (
							Number.isNaN(updatedAt) || updatedAt >= updatedAfter.getTime()
						)
					})

					if (updatedPullRequests.length < response.data.length) done()

					return updatedPullRequests
				}
			)
			const parsedPullRequests = pullRequests.map(pullRequest =>
				gitHubPullRequestSchema.parse(pullRequest)
			)
			const detailedPullRequests = await this.loadMergedPullRequestDetails({
				octokit,
				owner: repository.owner.login,
				repo: repository.name,
				pullRequests: parsedPullRequests,
			})

			const syncPullRequests = detailedPullRequests.map(toGitHubSyncPullRequest)
			const diffStats = await this.loadPullRequestDiffStats({
				octokit,
				owner: repository.owner.login,
				repo: repository.name,
				numbers: syncPullRequests.map(pullRequest => pullRequest.number),
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
				pullRequests: syncPullRequests.map(pullRequest => ({
					...pullRequest,
					...diffStats.get(pullRequest.number),
				})),
				pullRequestCursorAt,
				rateLimit: readRateLimit(),
			}
		} catch (error) {
			throw this.toSyncFailure(error, 'repository', {
				externalRepositoryId: externalRepositoryId.toString(),
			})
		}
	}

	async getPullRequestConversation({
		accessToken,
		owner,
		pullRequestNumber,
		repo,
	}: {
		accessToken: string
		owner: string
		pullRequestNumber: number
		repo: string
	}): Promise<GitHubPullRequestConversation> {
		const { octokit, readRateLimit } = this.createOctokit(accessToken)
		const target = { octokit, owner, pullRequestNumber, repo }

		try {
			const [
				issueComments,
				reviewComments,
				reviews,
				requestedReviewers,
				reviewThreads,
			] = await Promise.all([
				this.listIssueComments(target),
				this.listReviewComments(target),
				this.listReviews(target),
				this.listRequestedReviewers(target),
				this.listReviewThreads(target),
			])

			return {
				issueComments,
				reviewComments,
				reviews,
				requestedReviewers,
				reviewThreads,
				rateLimit: readRateLimit(),
			}
		} catch (error) {
			throw this.toSyncFailure(error, 'conversation', {
				owner,
				repo,
				pullRequestNumber,
			})
		}
	}

	/**
	 * Everything GitHub reports for one commit. Suites are listed first and their
	 * runs read per suite because `checks.listForRef` only reaches runs from the
	 * thousand most recent suites, which is a repair source that quietly stops
	 * repairing. The combined status endpoint is never used: it collapses a
	 * context's history to its newest entry and omits check runs entirely.
	 */
	async getChecksForRef({
		accessToken,
		owner,
		ref,
		repo,
	}: {
		accessToken: string
		owner: string
		ref: string
		repo: string
	}): Promise<GitHubChecksSnapshot> {
		const { octokit, readRateLimit } = this.createOctokit(accessToken)
		const target = { owner, ref, repo }
		const suites = await this.requestChecks(target, 'ref', () =>
			this.listCheckSuites({ octokit, owner, ref, repo })
		)
		const runs: GitHubSyncCheckRun[] = []

		// A suite GitHub pruned between the listing and this page reads as a 404 of
		// its own, which says nothing about the commit — hence the narrower scope.
		for (const suite of suites)
			runs.push(
				...(await this.requestChecks(target, 'suite', () =>
					this.listCheckRuns({
						octokit,
						owner,
						repo,
						suiteNumericId: suite.numericId,
					})
				))
			)

		const statuses = await this.requestChecks(target, 'ref', () =>
			this.listCommitStatuses({ octokit, owner, ref, repo })
		)

		return { sha: ref, suites, runs, statuses, rateLimit: readRateLimit() }
	}

	/**
	 * Fails one checks request with enough context to tell two different kinds of
	 * 404 apart.
	 *
	 * The classification travels in the context because a commit GitHub does not
	 * have is a permanent gap the projection has to be able to record, while every
	 * other failure has to fail the run and retry. The scope travels with it
	 * because only the ref-level listings speak for the commit: a missing child
	 * resource means this snapshot is incomplete, not that the commit is gone.
	 */
	private async requestChecks<TResult>(
		{ owner, ref, repo }: { owner: string; ref: string; repo: string },
		scope: GitHubChecksRequestScope,
		request: () => Promise<TResult>
	): Promise<TResult> {
		try {
			return await request()
		} catch (error) {
			throw this.toSyncFailure(error, scope, { owner, repo, ref })
		}
	}

	/**
	 * The one place a GitHub failure becomes something Tessera will keep. The
	 * classification is an allowlist — class, code, status, request id, rate-limit
	 * timing, schema issue paths — so no provider header, body, or message
	 * survives into the context that gets persisted and logged downstream.
	 *
	 * The original error is deliberately not attached as `cause`. An allowlisted
	 * context is worth nothing if the error it travels on still carries the whole
	 * provider response one property away: generic error logging already prints
	 * causes, and a response body or an authorization header would ride along.
	 */
	private toSyncFailure(
		error: unknown,
		scope: GitHubSyncRequestScope,
		resource: Record<string, unknown>
	): GitHubSyncExternalServiceError {
		const failure = classifyGitHubSyncFailure(error, scope)

		this.logger.warn(
			`GitHub ${scope} request failed as ${failure.failureClass}/${failure.failureCode}`
		)

		return new GitHubSyncExternalServiceError({ ...resource, ...failure })
	}

	private async listCheckSuites({
		octokit,
		owner,
		ref,
		repo,
	}: GitHubRefTarget): Promise<GitHubSyncCheckSuite[]> {
		const suites = await octokit.paginate(
			octokit.rest.checks.listSuitesForRef,
			{
				owner,
				repo,
				ref,
				per_page: GITHUB_PAGE_SIZE,
			}
		)

		return suites.map(suite => {
			const parsed = gitHubCheckSuiteSchema.parse(suite)

			return {
				nodeId: parsed.node_id,
				numericId: BigInt(parsed.id),
				headSha: parsed.head_sha,
				status: parsed.status ?? undefined,
				conclusion: parsed.conclusion ?? undefined,
				app: toGitHubSyncCheckApp(parsed.app),
				createdAt: toOptionalDate(parsed.created_at),
				updatedAt: toOptionalDate(parsed.updated_at),
			}
		})
	}

	private async listCheckRuns({
		octokit,
		owner,
		repo,
		suiteNumericId,
	}: {
		octokit: Octokit
		owner: string
		repo: string
		suiteNumericId: bigint
	}): Promise<GitHubSyncCheckRun[]> {
		const runs = await octokit.paginate(octokit.rest.checks.listForSuite, {
			owner,
			repo,
			check_suite_id: Number(suiteNumericId),
			// The default omits everything but the latest run per name, which is the
			// history this ledger exists to keep.
			filter: 'all',
			per_page: GITHUB_PAGE_SIZE,
		})

		return runs.map(run => {
			const parsed = gitHubCheckRunSchema.parse(run)

			return {
				nodeId: parsed.node_id,
				numericId: BigInt(parsed.id),
				suiteNodeId: parsed.check_suite?.node_id ?? undefined,
				suiteNumericId: parsed.check_suite
					? BigInt(parsed.check_suite.id)
					: suiteNumericId,
				name: parsed.name,
				headSha: parsed.head_sha,
				status: parsed.status ?? undefined,
				conclusion: parsed.conclusion ?? undefined,
				externalId: parsed.external_id ?? undefined,
				detailsUrl: parsed.details_url ?? undefined,
				htmlUrl: parsed.html_url ?? undefined,
				outputTitle: parsed.output?.title ?? undefined,
				outputSummary: parsed.output?.summary ?? undefined,
				app: toGitHubSyncCheckApp(parsed.app),
				startedAt: toOptionalDate(parsed.started_at),
				completedAt: toOptionalDate(parsed.completed_at),
			}
		})
	}

	private async listCommitStatuses({
		octokit,
		owner,
		ref,
		repo,
	}: GitHubRefTarget): Promise<GitHubSyncCommitStatus[]> {
		const statuses = await octokit.paginate(
			octokit.rest.repos.listCommitStatusesForRef,
			{
				owner,
				repo,
				ref,
				per_page: GITHUB_PAGE_SIZE,
			}
		)

		return statuses.map(status => {
			const parsed = gitHubCommitStatusSchema.parse(status)

			return {
				nodeId: parsed.node_id,
				numericId: BigInt(parsed.id),
				context: parsed.context,
				state: parsed.state,
				targetUrl: parsed.target_url ?? undefined,
				description: parsed.description ?? undefined,
				creator: parsed.creator ? toGitHubSyncActor(parsed.creator) : undefined,
				createdAt: new Date(parsed.created_at),
				updatedAt: new Date(parsed.updated_at),
			}
		})
	}

	private async listIssueComments({
		octokit,
		owner,
		pullRequestNumber,
		repo,
	}: GitHubPullRequestTarget): Promise<GitHubSyncIssueComment[]> {
		const comments = await octokit.paginate(octokit.rest.issues.listComments, {
			owner,
			repo,
			issue_number: pullRequestNumber,
			per_page: GITHUB_PAGE_SIZE,
		})

		return comments.flatMap(comment => {
			const parsed = toGitHubSyncIssueComment(
				gitHubIssueCommentSchema.parse(comment)
			)

			return parsed ? [parsed] : []
		})
	}

	private async listReviewComments({
		octokit,
		owner,
		pullRequestNumber,
		repo,
	}: GitHubPullRequestTarget): Promise<GitHubSyncReviewComment[]> {
		const comments = await octokit.paginate(
			octokit.rest.pulls.listReviewComments,
			{
				owner,
				repo,
				pull_number: pullRequestNumber,
				per_page: GITHUB_PAGE_SIZE,
			}
		)

		return comments.flatMap(comment => {
			const parsed = toGitHubSyncReviewComment(
				gitHubReviewCommentSchema.parse(comment)
			)

			return parsed ? [parsed] : []
		})
	}

	private async listReviews({
		octokit,
		owner,
		pullRequestNumber,
		repo,
	}: GitHubPullRequestTarget): Promise<GitHubSyncReview[]> {
		const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, {
			owner,
			repo,
			pull_number: pullRequestNumber,
			per_page: GITHUB_PAGE_SIZE,
		})

		return reviews.flatMap(review => {
			const parsed = toGitHubSyncReview(gitHubReviewSchema.parse(review))

			return parsed ? [parsed] : []
		})
	}

	private async listRequestedReviewers({
		octokit,
		owner,
		pullRequestNumber,
		repo,
	}: GitHubPullRequestTarget): Promise<GitHubSyncReviewerRequestTarget[]> {
		const response = await octokit.rest.pulls.listRequestedReviewers({
			owner,
			repo,
			pull_number: pullRequestNumber,
		})
		const { teams, users } = gitHubRequestedReviewersSchema.parse(response.data)

		return [
			...(users ?? []).map(
				(user): GitHubSyncReviewerRequestTarget => ({
					kind: 'user',
					actor: toGitHubSyncActor(user),
				})
			),
			...(teams ?? []).map(
				(team): GitHubSyncReviewerRequestTarget => ({
					kind: 'team',
					nodeId: team.node_id,
					numericId: BigInt(team.id),
					slug: team.slug,
					name: team.name,
					htmlUrl: team.html_url ?? undefined,
				})
			),
		]
	}

	private async listReviewThreads({
		octokit,
		owner,
		pullRequestNumber,
		repo,
	}: GitHubPullRequestTarget): Promise<GitHubSyncReviewThread[]> {
		const threads: GitHubSyncReviewThread[] = []
		let cursor: string | undefined

		do {
			const response = await octokit.graphql<unknown>(REVIEW_THREADS_QUERY, {
				owner,
				name: repo,
				number: pullRequestNumber,
				cursor,
			})
			const { repository } = gitHubReviewThreadsResponseSchema.parse(response)
			const reviewThreads = repository?.pullRequest?.reviewThreads

			// An empty connection is an answer; a page without the pull request is
			// missing data. Ending the walk there would hand the projection a
			// truncated list that reads as "these threads no longer exist".
			if (!reviewThreads)
				throw new Error('GitHub omitted the pull request review threads page')

			for (const node of reviewThreads.nodes ?? [])
				if (node) threads.push(toGitHubSyncReviewThread(node))

			cursor = reviewThreads.pageInfo.hasNextPage
				? (reviewThreads.pageInfo.endCursor ?? undefined)
				: undefined
		} while (cursor)

		return threads
	}

	/** Totals are a nicety, so a page that fails is dropped rather than failing the sync. */
	private async loadPullRequestDiffStats({
		numbers,
		octokit,
		owner,
		repo,
	}: {
		numbers: number[]
		octokit: Octokit
		owner: string
		repo: string
	}): Promise<Map<number, z.infer<typeof gitHubGraphQlDiffStatsSchema>>> {
		const diffStats = new Map<
			number,
			z.infer<typeof gitHubGraphQlDiffStatsSchema>
		>()

		for (let start = 0; start < numbers.length; start += GITHUB_PAGE_SIZE) {
			const batch = numbers.slice(start, start + GITHUB_PAGE_SIZE)

			try {
				const response = await octokit.graphql<unknown>(
					buildDiffStatsQuery(batch),
					{ owner, name: repo }
				)
				const { repository } = gitHubDiffStatsResponseSchema.parse(response)

				for (const number of batch) {
					const stats = repository?.[`${DIFF_STATS_ALIAS_PREFIX}${number}`]

					if (stats) diffStats.set(number, stats)
				}
			} catch (error) {
				this.logger.warn(
					`GitHub diff stats for ${owner}/${repo} could not be read`,
					error
				)
			}
		}

		return diffStats
	}

	private async loadMergedPullRequestDetails({
		octokit,
		owner,
		pullRequests,
		repo,
	}: {
		octokit: Octokit
		owner: string
		pullRequests: GitHubRestPullRequest[]
		repo: string
	}): Promise<GitHubRestPullRequest[]> {
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

interface GitHubPullRequestTarget {
	octokit: Octokit
	owner: string
	pullRequestNumber: number
	repo: string
}

interface GitHubRefTarget {
	octokit: Octokit
	owner: string
	ref: string
	repo: string
}

/**
 * The budget GitHub reported on a response it did answer. A successful read is
 * the cheapest place to notice a limit approaching, and clearing a stale defer
 * needs the same evidence.
 */
function toGitHubSyncRateLimit(
	headers: Record<string, unknown>
): GitHubSyncRateLimit | undefined {
	const remaining = toHeaderNumber(headers['x-ratelimit-remaining'])
	const resetSeconds = toHeaderNumber(headers['x-ratelimit-reset'])

	if (remaining === undefined || !Number.isInteger(remaining) || remaining < 0)
		return undefined

	return {
		remaining,
		resetAt:
			resetSeconds !== undefined && resetSeconds > 0
				? new Date(resetSeconds * 1000)
				: undefined,
	}
}

/**
 * A header value only when it is actually a number. `Number('')` and
 * `Number(null)` are both zero, and zero here means an exhausted budget — so an
 * absent or blank header would defer the whole installation on no evidence.
 */
function toHeaderNumber(value: unknown): number | undefined {
	if (typeof value === 'number')
		return Number.isFinite(value) ? value : undefined
	if (typeof value !== 'string' || value.trim().length === 0) return undefined

	const parsed = Number(value)

	return Number.isFinite(parsed) ? parsed : undefined
}

function toGitHubSyncCheckApp(
	app: z.infer<typeof gitHubCheckAppSchema> | null | undefined
): GitHubSyncCheckApp | undefined {
	if (!app) return undefined

	return {
		nodeId: app.node_id,
		numericId: BigInt(app.id),
		slug: app.slug ?? undefined,
		name: app.name ?? undefined,
		htmlUrl: app.html_url ?? undefined,
	}
}

function toGitHubSyncReviewThread(
	thread: z.infer<typeof gitHubGraphQlReviewThreadSchema>
): GitHubSyncReviewThread {
	return {
		nodeId: thread.id,
		resolved: thread.isResolved,
		resolvedBy: toGitHubSyncGraphQlActor(thread.resolvedBy),
		outdated: thread.isOutdated,
		subjectType: thread.subjectType === 'FILE' ? 'file' : 'line',
		path: thread.path ?? undefined,
		line: thread.line ?? undefined,
		side: toGitHubSyncDiffSide(thread.diffSide),
		comments: (thread.comments.nodes ?? []).flatMap(comment =>
			comment
				? [
						{
							nodeId: comment.id,
							replyToNodeId: comment.replyTo?.id,
							originalCommitSha: comment.originalCommit?.oid,
						},
					]
				: []
		),
	}
}

function toGitHubSyncGraphQlActor(
	actor: z.infer<typeof gitHubGraphQlActorSchema> | null | undefined
): GitHubSyncActor | undefined {
	if (!(actor?.id && actor.databaseId)) return undefined

	return {
		nodeId: actor.id,
		numericId: BigInt(actor.databaseId),
		login: actor.login,
		type: toGitHubSyncActorType(actor.__typename),
		avatarUrl: actor.avatarUrl ?? undefined,
		htmlUrl: actor.url ?? undefined,
	}
}

function getPullRequestCursorAt(providerDate?: string): Date {
	const providerTimestamp = providerDate ? Date.parse(providerDate) : Number.NaN

	if (!Number.isNaN(providerTimestamp)) return new Date(providerTimestamp)

	return new Date(
		Math.floor((Date.now() - GITHUB_CURSOR_FALLBACK_OVERLAP_MS) / 1000) * 1000
	)
}
