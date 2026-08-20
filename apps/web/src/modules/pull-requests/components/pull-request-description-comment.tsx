import type { PullRequest, PullRequestActor } from '@repo/contracts'
import { Button } from '@repo/ui/components/button'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@repo/ui/components/popover'
import { MoreHorizontal, Pencil } from 'lucide-react'
import { useState } from 'react'
import { MarkdownContent } from '@/shared/components/markdown-content'
import {
	formatPullRequestDate,
	formatPullRequestDateTime,
} from '../helpers/pull-request-formatting'
import { PullRequestActorLabel } from './pull-request-actor-label'
import { PullRequestDescriptionEditForm } from './pull-request-edit-form'

interface PullRequestDescriptionCommentProps {
	username: string
	slug: string
	pullRequest: PullRequest
	/** The identity the `opened` event kept, which carries an avatar and profile. */
	author?: PullRequestActor
	canWrite: boolean
}

/**
 * The description, as the first comment of the conversation. It is the same
 * shape every other comment has because it is the same thing: what the author
 * said when they opened the pull request. Its own headings live in the body, so
 * the card adds none of its own.
 */
export function PullRequestDescriptionComment({
	username,
	slug,
	pullRequest,
	author,
	canWrite,
}: Readonly<PullRequestDescriptionCommentProps>) {
	const [isEditing, setIsEditing] = useState(false)

	const actor: PullRequestActor = author ?? {
		key: `${pullRequest.provider}:${pullRequest.authorUsername}`,
		provider: pullRequest.provider,
		userId: pullRequest.authorUserId,
		username: pullRequest.authorUsername,
	}

	return (
		<article className="overflow-hidden rounded-xl border border-border bg-card">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-border border-b bg-muted/40 px-4 py-2">
				<PullRequestActorLabel actor={actor} className="text-sm" />
				<span className="text-muted-foreground text-sm">commented</span>
				<time
					className="text-muted-foreground text-xs"
					dateTime={formatPullRequestDateTime(pullRequest.createdAt)}
				>
					{formatPullRequestDate(pullRequest.createdAt)}
				</time>
				{canWrite && !isEditing && (
					<PullRequestDescriptionMenu onEdit={() => setIsEditing(true)} />
				)}
			</div>
			<div className="px-4 py-3">
				{isEditing ? (
					<PullRequestDescriptionEditForm
						onDone={() => setIsEditing(false)}
						pullRequest={pullRequest}
						slug={slug}
						username={username}
					/>
				) : (
					<PullRequestDescriptionBody body={pullRequest.body} />
				)}
			</div>
		</article>
	)
}

function PullRequestDescriptionBody({ body }: Readonly<{ body: string }>) {
	if (!body)
		return (
			<p className="text-muted-foreground text-sm italic">
				No description provided.
			</p>
		)

	return <MarkdownContent>{body}</MarkdownContent>
}

function PullRequestDescriptionMenu({
	onEdit,
}: Readonly<{ onEdit: () => void }>) {
	const [isOpen, setIsOpen] = useState(false)

	return (
		<Popover onOpenChange={setIsOpen} open={isOpen}>
			<PopoverTrigger
				aria-label="Description actions"
				className="ml-auto inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
			>
				<MoreHorizontal aria-hidden className="size-4" />
			</PopoverTrigger>
			<PopoverContent align="end" className="p-1">
				<Button
					className="w-full justify-start"
					onClick={() => {
						setIsOpen(false)
						onEdit()
					}}
					size="sm"
					variant="ghost"
				>
					<Pencil aria-hidden className="size-4" />
					Edit description
				</Button>
			</PopoverContent>
		</Popover>
	)
}
