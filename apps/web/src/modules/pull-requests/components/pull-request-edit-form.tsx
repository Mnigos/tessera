import type { PullRequest } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import { type ComponentProps, useState } from 'react'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import { useEditPullRequestMutation } from '../hooks/use-edit-pull-request.mutation'

interface PullRequestEditFormProps {
	username: string
	slug: string
	pullRequest: PullRequest
	onDone: () => void
}

export function PullRequestEditForm({
	username,
	slug,
	pullRequest,
	onDone,
}: Readonly<PullRequestEditFormProps>) {
	const editMutation = useEditPullRequestMutation()
	const [titleError, setTitleError] = useState<string>()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const formData = new FormData(event.currentTarget)
		const title = String(formData.get('title') ?? '').trim()
		const body = String(formData.get('body') ?? '')

		if (!title) {
			setTitleError('Title must contain at least one non-space character.')
			return
		}

		setTitleError(undefined)

		editMutation.mutate(
			{ username, slug, number: pullRequest.number, title, body },
			{ onSuccess: onDone }
		)
	}

	return (
		<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
			<div className="flex flex-col gap-2">
				<Label htmlFor="pull-request-edit-title">Title</Label>
				<input
					aria-describedby={
						titleError ? 'pull-request-edit-title-error' : undefined
					}
					aria-invalid={Boolean(titleError)}
					className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					defaultValue={pullRequest.title}
					id="pull-request-edit-title"
					maxLength={256}
					name="title"
					onChange={() => setTitleError(undefined)}
					required
				/>
				{titleError && (
					<p
						className="text-destructive text-sm"
						id="pull-request-edit-title-error"
						role="alert"
					>
						{titleError}
					</p>
				)}
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="pull-request-edit-body">Description</Label>
				<textarea
					className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					defaultValue={pullRequest.body}
					id="pull-request-edit-body"
					maxLength={65_536}
					name="body"
				/>
			</div>
			{editMutation.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						editMutation.error,
						'The pull request could not be updated.'
					)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button disabled={editMutation.isPending} size="sm" type="submit">
					{editMutation.isPending ? 'Saving' : 'Save changes'}
				</Button>
				<Button onClick={onDone} size="sm" type="button" variant="secondary">
					Cancel
				</Button>
			</div>
		</form>
	)
}
