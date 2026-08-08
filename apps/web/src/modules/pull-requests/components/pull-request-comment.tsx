import type { PullRequestComment as PullRequestCommentData } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import { EyeOff, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { MarkdownContent } from '@/shared/components/markdown-content'
import { getPullRequestErrorMessage } from '../helpers/get-pull-request-error-message'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import {
	canDeletePullRequestComment,
	canEditPullRequestComment,
	type PullRequestThreadPermissions,
} from '../helpers/pull-request-thread-permissions'
import { useDeletePullRequestCommentMutation } from '../hooks/use-delete-pull-request-comment.mutation'
import { useEditPullRequestCommentMutation } from '../hooks/use-edit-pull-request-comment.mutation'
import { PullRequestCommentComposer } from './pull-request-comment-composer'
import { PullRequestSourceLink } from './pull-request-source-link'

interface PullRequestCommentProps {
	username: string
	slug: string
	number: string
	comment: PullRequestCommentData
	permissions: PullRequestThreadPermissions
}

export function PullRequestComment({
	username,
	slug,
	number,
	comment,
	permissions,
}: Readonly<PullRequestCommentProps>) {
	const [isEditing, setIsEditing] = useState(false)
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
	const editMutation = useEditPullRequestCommentMutation()
	const deleteMutation = useDeletePullRequestCommentMutation()

	const canEdit = canEditPullRequestComment(permissions, comment)
	const canDelete = canDeletePullRequestComment(permissions, comment)

	function handleEdit(body: string) {
		editMutation.mutate(
			{ username, slug, number, commentId: comment.id, body },
			{ onSuccess: () => setIsEditing(false) }
		)
	}

	function handleDelete() {
		deleteMutation.mutate({ username, slug, number, commentId: comment.id })
	}

	return (
		<li className="flex flex-col gap-2">
			<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<span className="font-medium text-sm">{comment.author.username}</span>
				<time
					className="text-muted-foreground text-xs"
					dateTime={formatPullRequestDateTime(comment.createdAt)}
				>
					{formatPullRequestDate(comment.createdAt)}
				</time>
				{comment.editedAt && (
					<span className="text-muted-foreground text-xs">edited</span>
				)}
				{comment.sourceUrl && (
					<PullRequestSourceLink
						className="text-muted-foreground text-xs"
						href={comment.sourceUrl}
					/>
				)}
				{comment.state === 'pending' && (
					<span
						className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-amber-400 text-xs"
						title="Only you can see this comment until you submit your review."
					>
						<EyeOff aria-hidden className="size-3" />
						Pending
					</span>
				)}
				{(canEdit || canDelete) && !isEditing && (
					<span className="ml-auto flex items-center gap-1">
						{canEdit && (
							<Button
								aria-label="Edit comment"
								className="size-7 text-muted-foreground"
								onClick={() => setIsEditing(true)}
								size="icon"
								variant="ghost"
							>
								<Pencil />
							</Button>
						)}
						{canDelete && (
							<Button
								aria-label="Delete comment"
								className="size-7 text-muted-foreground"
								onClick={() => setIsConfirmingDelete(true)}
								size="icon"
								variant="ghost"
							>
								<Trash2 />
							</Button>
						)}
					</span>
				)}
			</div>
			{isEditing ? (
				<PullRequestCommentComposer
					defaultValue={comment.body}
					errorMessage={
						editMutation.isError
							? getPullRequestErrorMessage(
									editMutation.error,
									'The comment could not be updated.'
								)
							: undefined
					}
					inputId={`pull-request-comment-edit-${comment.id}`}
					isPending={editMutation.isPending}
					label="Edit comment"
					onCancel={() => setIsEditing(false)}
					onSubmit={handleEdit}
					pendingLabel="Saving"
					shouldFocusOnMount
					submitLabel="Save changes"
				/>
			) : (
				<MarkdownContent>{comment.body}</MarkdownContent>
			)}
			{isConfirmingDelete && (
				<div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
					<p className="text-sm">Delete this comment permanently?</p>
					<Button
						className="ml-auto"
						disabled={deleteMutation.isPending}
						onClick={handleDelete}
						size="sm"
						variant="destructive"
					>
						{deleteMutation.isPending ? 'Deleting' : 'Delete'}
					</Button>
					<Button
						onClick={() => setIsConfirmingDelete(false)}
						size="sm"
						variant="secondary"
					>
						Cancel
					</Button>
				</div>
			)}
			{deleteMutation.isError && (
				<p className="text-destructive text-sm" role="alert">
					{getPullRequestErrorMessage(
						deleteMutation.error,
						'The comment could not be deleted.'
					)}
				</p>
			)}
		</li>
	)
}
