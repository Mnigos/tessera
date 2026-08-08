import type { PullRequestReviewerCandidate } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import { UserPlus } from 'lucide-react'
import type { ComponentProps } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { useRequestPullRequestReviewerMutation } from '../hooks/use-request-pull-request-reviewer.mutation'

const REVIEWER_INPUT_ID = 'pull-request-reviewer-username'
const REVIEWER_ERROR_ID = 'pull-request-reviewer-error'
const SUGGESTION_LIMIT = 5

interface PullRequestRequestReviewerFormProps {
	username: string
	slug: string
	number: string
	candidates: readonly PullRequestReviewerCandidate[]
	listedUsernames: readonly string[]
}

export function PullRequestRequestReviewerForm({
	username,
	slug,
	number,
	candidates,
	listedUsernames,
}: Readonly<PullRequestRequestReviewerFormProps>) {
	const requestReviewer = useRequestPullRequestReviewerMutation()

	const suggestions = candidates
		.filter(candidate => !listedUsernames.includes(candidate.username))
		.slice(0, SUGGESTION_LIMIT)

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const form = event.currentTarget
		const reviewerUsername = String(
			new FormData(form).get('reviewerUsername') ?? ''
		).trim()

		if (!reviewerUsername) return

		requestReviewer.mutate(
			{ username, slug, number, reviewerUsername },
			{ onSuccess: () => form.reset() }
		)
	}

	return (
		<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
			<Label
				className="text-muted-foreground text-xs"
				htmlFor={REVIEWER_INPUT_ID}
			>
				Request a review
			</Label>
			<div className="flex items-center gap-2">
				<input
					aria-describedby={
						requestReviewer.isError ? REVIEWER_ERROR_ID : undefined
					}
					autoComplete="off"
					className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					id={REVIEWER_INPUT_ID}
					name="reviewerUsername"
					placeholder="Username"
					required
				/>
				<Button
					aria-label="Request review"
					className="size-8 shrink-0"
					disabled={requestReviewer.isPending}
					size="icon"
					type="submit"
					variant="outline"
				>
					<UserPlus className="size-4" />
				</Button>
			</div>
			{suggestions.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5">
					{suggestions.map(candidate => (
						<Button
							className="h-6 rounded-full px-2 text-muted-foreground text-xs"
							disabled={requestReviewer.isPending}
							key={candidate.userId}
							onClick={() =>
								requestReviewer.mutate({
									username,
									slug,
									number,
									reviewerUsername: candidate.username,
								})
							}
							size="sm"
							type="button"
							variant="outline"
						>
							{candidate.username}
						</Button>
					))}
				</div>
			)}
			{requestReviewer.isError && (
				<p
					className="text-destructive text-sm"
					id={REVIEWER_ERROR_ID}
					role="alert"
				>
					{getPullRequestErrorMessage(
						requestReviewer.error,
						'The review could not be requested.'
					)}
				</p>
			)}
		</form>
	)
}
