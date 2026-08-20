import type { PullRequest } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { type ComponentProps, useState } from 'react'
import { useEditPullRequestMutation } from '../hooks/use-edit-pull-request.mutation'
import { PullRequestErrorMessage } from './pull-request-error-message'
import { PullRequestMarkdownEditor } from './pull-request-markdown-editor'

const TITLE_INPUT_ID = 'pull-request-edit-title'
const TITLE_ERROR_ID = 'pull-request-edit-title-error'

// Module-level so the ref attaches once, on mount, rather than every render.
function focusTitleOnMount(node: HTMLInputElement | null) {
	node?.select()
}

interface PullRequestEditFormProps {
	username: string
	slug: string
	pullRequest: PullRequest
	onDone: () => void
}

/**
 * The title, edited where it is read. Title and description are separate writes
 * because they are separate decisions: renaming a pull request never has to
 * carry its whole body along to be saved.
 */
export function PullRequestTitleEditForm({
	username,
	slug,
	pullRequest,
	onDone,
}: Readonly<PullRequestEditFormProps>) {
	const editMutation = useEditPullRequestMutation()
	const [titleError, setTitleError] = useState<string>()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const title = String(
			new FormData(event.currentTarget).get('title') ?? ''
		).trim()

		if (!title) {
			setTitleError('Title must contain at least one non-space character.')
			return
		}

		setTitleError(undefined)

		editMutation.mutate(
			{ username, slug, number: pullRequest.number, title },
			{ onSuccess: onDone }
		)
	}

	return (
		<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
			<div className="flex flex-wrap items-center gap-2">
				<label className="sr-only" htmlFor={TITLE_INPUT_ID}>
					Title
				</label>
				<input
					aria-describedby={titleError ? TITLE_ERROR_ID : undefined}
					aria-invalid={Boolean(titleError)}
					className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 py-2 text-base outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
					defaultValue={pullRequest.title}
					id={TITLE_INPUT_ID}
					maxLength={256}
					name="title"
					onChange={() => setTitleError(undefined)}
					ref={focusTitleOnMount}
					required
				/>
				<Button disabled={editMutation.isPending} size="sm" type="submit">
					{editMutation.isPending ? 'Saving' : 'Save'}
				</Button>
				<Button onClick={onDone} size="sm" type="button" variant="secondary">
					Cancel
				</Button>
			</div>
			{titleError && (
				<p
					className="text-destructive text-sm"
					id={TITLE_ERROR_ID}
					role="alert"
				>
					{titleError}
				</p>
			)}
			{editMutation.isError && (
				<PullRequestErrorMessage
					error={editMutation.error}
					fallback="The pull request could not be updated."
				/>
			)}
		</form>
	)
}

/** The description, edited inside the comment that renders it. */
export function PullRequestDescriptionEditForm({
	username,
	slug,
	pullRequest,
	onDone,
}: Readonly<PullRequestEditFormProps>) {
	const editMutation = useEditPullRequestMutation()

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		const body = String(new FormData(event.currentTarget).get('body') ?? '')

		editMutation.mutate(
			{ username, slug, number: pullRequest.number, body },
			{ onSuccess: onDone }
		)
	}

	return (
		<form className="flex flex-col gap-3" onSubmit={handleSubmit}>
			<PullRequestMarkdownEditor
				defaultValue={pullRequest.body}
				id="pull-request-edit-body"
				label="Description"
				name="body"
			/>
			{editMutation.isError && (
				<PullRequestErrorMessage
					error={editMutation.error}
					fallback="The pull request could not be updated."
				/>
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
