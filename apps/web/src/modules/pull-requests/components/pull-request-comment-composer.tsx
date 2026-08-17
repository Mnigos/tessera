import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import { type ComponentProps, useState } from 'react'
import { isGitHubSyncDelayedError } from '../helpers/get-pull-request-error-message'
import { submitPullRequestComposerOnShortcut } from '../helpers/pull-request-composer-shortcut'
import { PullRequestErrorMessage } from './pull-request-error-message'

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

	function focusOnMount(node: HTMLTextAreaElement | null) {
		if (node && shouldFocusOnMount) node.focus()
	}

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

	return (
		<form className="flex flex-col gap-2" onSubmit={handleSubmit}>
			<Label className="sr-only" htmlFor={inputId}>
				{label}
			</Label>
			<textarea
				className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
				id={inputId}
				maxLength={65_536}
				onChange={event => setBody(event.target.value)}
				onKeyDown={submitPullRequestComposerOnShortcut}
				placeholder={placeholder}
				ref={focusOnMount}
				value={body}
			/>
			{Boolean(error) && (
				<PullRequestErrorMessage error={error} fallback={errorFallback} />
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={isSpent} size="sm" type="submit">
					{isPending ? pendingLabel : submitLabel}
				</Button>
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
				{onCancel && (
					<Button
						onClick={onCancel}
						size="sm"
						type="button"
						variant="secondary"
					>
						Cancel
					</Button>
				)}
				<span className="text-muted-foreground text-xs">
					Markdown is supported.
				</span>
			</div>
		</form>
	)
}
