import { ORPCError, safe } from '@orpc/client'
import {
	type PullRequestReviewId,
	pullRequestReviewIdSchema,
	pullRequestThreadIdSchema,
} from '@repo/contracts'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { z } from 'zod'
import { PullRequestDetail } from '../components/pull-request-detail'
import { toPullRequestDisplayNumber } from '../helpers/pull-request-display-number'
import { getPullRequestQueryOptions } from '../hooks/use-pull-request.query'
import { getPullRequestComparisonQueryOptions } from '../hooks/use-pull-request-comparison.query'
import { getPullRequestReviewComparisonQueryOptions } from '../hooks/use-pull-request-review-comparison.query'

export const Route = createFileRoute('/$username/$slug/pulls/$number/files')({
	// One optional review rather than a mode beside it: naming a review is what
	// selects the since-review comparison, so no combination of the two can be
	// contradictory.
	validateSearch: z.object({
		reviewId: pullRequestReviewIdSchema.optional(),
		/** A thread to land on, carried by anchor links in the conversation. */
		thread: pullRequestThreadIdSchema.optional(),
	}),
	loaderDeps: ({ search: { reviewId } }) => ({ reviewId }),
	loader: async ({
		context,
		deps: { reviewId },
		params: { username, slug, number },
	}) => {
		const input = { username, slug, number }
		const [error, data] = await safe(
			Promise.all([
				context.queryClient.ensureQueryData(getPullRequestQueryOptions(input)),
				// A review the server will not compare against is answered on the page,
				// beside the switch back to the full diff, instead of replacing the
				// pull request with a not-found.
				reviewId
					? context.queryClient.prefetchQuery(
							getPullRequestReviewComparisonQueryOptions({ ...input, reviewId })
						)
					: context.queryClient.ensureQueryData(
							getPullRequestComparisonQueryOptions(input)
						),
			])
		)

		if (error instanceof ORPCError && error.status === 404) throw notFound()

		if (error) throw error

		const [{ pullRequest }] = data

		return { displayNumber: toPullRequestDisplayNumber(pullRequest) }
	},
	head: ({ loaderData, params }) => ({
		meta: [
			{
				title: `${params.username}/${params.slug} #${loaderData?.displayNumber ?? params.number} files changed · detent`,
			},
		],
	}),
	component: PullRequestFilesRoute,
})

function PullRequestFilesRoute() {
	const { username, slug, number } = Route.useParams()
	const { reviewId, thread } = Route.useSearch()
	const navigate = Route.useNavigate()

	function handleSelectedReviewIdChange(
		selectedReviewId?: PullRequestReviewId
	) {
		navigate({
			search: previousSearch => ({
				...previousSearch,
				reviewId: selectedReviewId,
			}),
		})
	}

	return (
		<PullRequestDetail
			number={number}
			reviewSelection={{
				reviewId,
				onReviewIdChange: handleSelectedReviewIdChange,
			}}
			slug={slug}
			tab="files"
			threadJumpId={thread}
			username={username}
		/>
	)
}
