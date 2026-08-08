import { GitStorageClient } from '@config/git-storage'
import { Injectable, Logger } from '@nestjs/common'
import type { PullRequestId, RepositoryId } from '@repo/domain'
import { getPullRequestComparisonRefs } from '../helpers/pull-request-comparison-refs'
import type { PullRequestReadModel } from '../infrastructure/pull-requests.repository'

/**
 * A commit a read model attributes work to, and whether the pull request still
 * points at it. Results computed against a commit the pull request has moved
 * past stay readable; they just stop speaking for it.
 */
export interface PullRequestHeadRef {
	sha: string
	isCurrent: boolean
}

interface ResolveHeadParams {
	pullRequest: PullRequestReadModel
	repositoryId: RepositoryId
	storagePath: string
}

interface ListHeadRefsParams {
	pullRequests: PullRequestReadModel[]
	repositoryId: RepositoryId
	storagePath: string
}

/**
 * Everything that needs to know which commit a pull request currently points at.
 *
 * Two strategies, deliberately kept apart. `resolveCurrentHeadSha` asks git to
 * compare the pull request's refs, which is exact for any state and expensive
 * enough to be worth one call. `listHeadRefs` reads branch targets, which is one
 * call for a whole page and only speaks for pull requests that are still open.
 */
@Injectable()
export class PullRequestHeadResolver {
	private readonly logger = new Logger(PullRequestHeadResolver.name)

	constructor(private readonly gitStorageClient: GitStorageClient) {}

	/**
	 * Head the pull request currently points at, used to age out reviews. Returns
	 * undefined when git cannot resolve it — an unresolvable head must not make
	 * every stored review look stale.
	 */
	async resolveCurrentHeadSha({
		pullRequest,
		repositoryId,
		storagePath,
	}: ResolveHeadParams): Promise<string | undefined> {
		if (pullRequest.github) return pullRequest.github.headSha

		const { baseRef, headRef } = getPullRequestComparisonRefs(pullRequest)

		try {
			const { headSha } = await this.gitStorageClient.compareRepositoryRefs({
				repositoryId,
				storagePath,
				baseRef,
				headRef,
			})

			return headSha
		} catch (error) {
			this.logger.warn(
				`Failed to resolve the current head of pull request ${pullRequest.id}`,
				error instanceof Error ? error.stack : undefined
			)

			return undefined
		}
	}

	/** The cheap resolution for a single pull request, sharing the batch's rules. */
	async resolveHeadRef({
		pullRequest,
		repositoryId,
		storagePath,
	}: ResolveHeadParams): Promise<PullRequestHeadRef> {
		const headRefs = await this.listHeadRefs({
			pullRequests: [pullRequest],
			repositoryId,
			storagePath,
		})

		return (
			headRefs.get(pullRequest.id) ?? {
				sha: pullRequest.openingHeadSha,
				isCurrent: false,
			}
		)
	}

	/**
	 * Heads for a whole page: one refs lookup for every native pull request
	 * instead of a comparison per row.
	 *
	 * A synchronized pull request carries its head in its GitHub mapping, so it
	 * costs nothing and stays exact after the pull request closes. A native one
	 * resolves through the branch it was opened from, which only points at its
	 * head while it is open; anything else falls back to the commit it opened
	 * against, marked as no longer current.
	 */
	async listHeadRefs({
		pullRequests,
		repositoryId,
		storagePath,
	}: ListHeadRefsParams): Promise<Map<PullRequestId, PullRequestHeadRef>> {
		const headRefs = new Map<PullRequestId, PullRequestHeadRef>()
		const openNativePullRequests = pullRequests.filter(
			pullRequest => !pullRequest.github && pullRequest.state === 'open'
		)

		for (const pullRequest of pullRequests)
			if (pullRequest.github)
				headRefs.set(pullRequest.id, {
					sha: pullRequest.github.headSha,
					isCurrent: true,
				})

		const branchTargets = await this.listBranchTargets({
			repositoryId,
			storagePath,
			isNeeded: openNativePullRequests.length > 0,
		})

		for (const pullRequest of pullRequests) {
			if (pullRequest.github) continue

			const target =
				pullRequest.state === 'open'
					? branchTargets.get(pullRequest.sourceBranch)
					: undefined

			headRefs.set(
				pullRequest.id,
				target
					? { sha: target, isCurrent: true }
					: { sha: pullRequest.openingHeadSha, isCurrent: false }
			)
		}

		return headRefs
	}

	private async listBranchTargets({
		isNeeded,
		repositoryId,
		storagePath,
	}: {
		isNeeded: boolean
		repositoryId: RepositoryId
		storagePath: string
	}): Promise<Map<string, string>> {
		if (!isNeeded) return new Map()

		try {
			const refs = await this.gitStorageClient.listRepositoryRefs({
				repositoryId,
				storagePath,
				trustedGpgKeys: [],
			})

			return new Map(refs.branches.map(branch => [branch.name, branch.target]))
		} catch (error) {
			this.logger.warn(
				`Failed to resolve current heads for repository ${repositoryId}`,
				error instanceof Error ? error.stack : undefined
			)

			return new Map()
		}
	}
}
