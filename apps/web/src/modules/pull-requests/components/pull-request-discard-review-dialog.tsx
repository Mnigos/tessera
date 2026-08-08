import { Button } from '@repo/ui/components/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@repo/ui/components/dialog'
import { useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { useDiscardPullRequestReviewMutation } from '../hooks/use-discard-pull-request-review.mutation'

interface PullRequestDiscardReviewDialogProps {
	username: string
	slug: string
	number: string
	commentCount: number
}

export function PullRequestDiscardReviewDialog({
	username,
	slug,
	number,
	commentCount,
}: Readonly<PullRequestDiscardReviewDialogProps>) {
	const [isOpen, setIsOpen] = useState(false)
	const discardReview = useDiscardPullRequestReviewMutation()

	function handleOpenChange(open: boolean) {
		setIsOpen(open)

		if (!open) discardReview.reset()
	}

	function handleDiscard() {
		discardReview.mutate(
			{ username, slug, number },
			{ onSuccess: () => setIsOpen(false) }
		)
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={isOpen}>
			<DialogTrigger render={<Button size="sm" variant="ghost" />}>
				Discard
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Discard pending review</DialogTitle>
					<DialogDescription>
						{commentCount
							? `Your ${commentCount} pending ${commentCount === 1 ? 'comment' : 'comments'} will be deleted permanently. Nobody else has seen them.`
							: 'Your pending review will be deleted. Nobody else has seen it.'}
					</DialogDescription>
				</DialogHeader>
				{discardReview.isError && (
					<p className="text-destructive text-sm" role="alert">
						{getPullRequestErrorMessage(
							discardReview.error,
							'The pending review could not be discarded.'
						)}
					</p>
				)}
				<DialogFooter>
					<DialogClose render={<Button variant="secondary" />}>
						Keep review
					</DialogClose>
					<Button
						disabled={discardReview.isPending}
						onClick={handleDiscard}
						variant="destructive"
					>
						{discardReview.isPending ? 'Discarding' : 'Discard review'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
