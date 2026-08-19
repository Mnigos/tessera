import { Avatar } from '@repo/ui/components/avatar'
import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import { type ComponentProps, type KeyboardEventHandler, useState } from 'react'
import { useAuth } from '@/modules/auth/hooks/use-auth'
import { isGitHubSyncDelayedError } from '../helpers/get-pull-request-error-message'
import { submitPullRequestComposerOnShortcut } from '../helpers/pull-request-composer-shortcut'
import { PullRequestErrorMessage } from './pull-request-error-message'
import { PullRequestMarkdownField } from './pull-request-markdown-editor'

interface PullRequestCommentComposerProps {
	inputId: string
	label: string
	submitLabel: string
	pendingLabel: string
	isPending: boolean
	onSubmit: (body: string) => void
	defaultValue?: string
	/** The failed write itself, so its refusal can offer its own way out. */
	error?: unknown
	errorFallback: string
	heading?: string
	/** Whether the primary action batches into the review the viewer has open. */
	isAddingToReview?: boolean
	onCancel?: () => void
	onSecondarySubmit?: (body: string) => void
	placeholder?: string
	secondarySubmitLabel?: string
	shouldFocusOnMount?: boolean
}

export function PullRequestCommentComposer({
	inputId,
	label,
	submitLabel,
	pendingLabel,
	isPending,
	onSubmit,
	defaultValue,
	error,
	errorFallback,
	heading,
	isAddingToReview = false,
	onCancel,
	onSecondarySubmit,
	placeholder,
	secondarySubmitLabel,
	shouldFocusOnMount,
}: Readonly<PullRequestCommentComposerProps>) {
	const [body, setBody] = useState(defaultValue ?? '')
	const [sentBody, setSentBody] = useState<string>()
	const trimmedBody = body.trim()
	// Resending this exact draft would post a second copy of what GitHub took.
	const isSpent =
		trimmedBody.length === 0 ||
		isPending ||
		(isGitHubSyncDelayedError(error) && trimmedBody === sentBody)

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		if (isSpent) return

		setSentBody(trimmedBody)
		onSubmit(trimmedBody)
	}

	function handleSecondarySubmit() {
		if (isSpent || !onSecondarySubmit) return

		setSentBody(trimmedBody)
		onSecondarySubmit(trimmedBody)
	}

	const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = event => {
		if (event.key === 'Escape' && onCancel) {
			event.preventDefault()
			onCancel()

			return
		}

		submitPullRequestComposerOnShortcut(event)
	}

	return (
		<form
			className="flex flex-col rounded-md border border-border bg-card"
			onSubmit={handleSubmit}
		>
			{heading && (
				<div className="flex items-center gap-2 border-border border-b px-3 py-2">
					<PullRequestComposerAvatar />
					<h3 className="min-w-0 truncate font-medium text-sm">{heading}</h3>
					{isAddingToReview && (
						<span className="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-[0.6875rem] text-primary">
							Adding to your pending review
						</span>
					)}
					{onCancel && (
						<span className="ml-auto shrink-0 text-[0.6875rem] text-muted-foreground">
							Esc to cancel
						</span>
					)}
				</div>
			)}
			<div className="flex flex-col gap-2 px-3 py-2">
				<Label className="sr-only" htmlFor={inputId}>
					{label}
				</Label>
				<PullRequestMarkdownField
					id={inputId}
					modeLabel={`${label} mode`}
					onKeyDown={handleKeyDown}
					onValueChange={setBody}
					placeholder={placeholder}
					shouldFocusOnMount={shouldFocusOnMount}
					textareaClassName="min-h-22 resize-y font-sans"
					value={body}
				/>
				{Boolean(error) && (
					<PullRequestErrorMessage error={error} fallback={errorFallback} />
				)}
			</div>
			<div className="flex flex-wrap items-center gap-2 border-border border-t px-3 py-2">
				<span className="text-muted-foreground text-xs">
					Markdown · ⌘⏎ to submit
				</span>
				<div className="ml-auto flex flex-wrap items-center gap-2">
					{onCancel && (
						<Button onClick={onCancel} size="sm" type="button" variant="ghost">
							Cancel
						</Button>
					)}
					{onSecondarySubmit && secondarySubmitLabel && (
						<Button
							disabled={isSpent}
							onClick={handleSecondarySubmit}
							size="sm"
							type="button"
							variant="outline"
						>
							{secondarySubmitLabel}
						</Button>
					)}
					<Button disabled={isSpent} size="sm" type="submit">
						{isPending ? pendingLabel : submitLabel}
					</Button>
				</div>
			</div>
		</form>
	)
}

// Decorative: the heading beside it already says whose draft this is.
function PullRequestComposerAvatar() {
	const { user } = useAuth()

	if (!user?.avatarUrl)
		return (
			<Avatar
				className="size-5 shrink-0 text-[0.625rem]"
				displayName={user?.displayName ?? ''}
				size="sm"
			/>
		)

	return (
		<img
			alt=""
			className="size-5 shrink-0 rounded-full bg-muted"
			height={20}
			src={user.avatarUrl}
			width={20}
		/>
	)
}
