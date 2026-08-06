import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import { type ComponentProps, useState } from 'react'

interface PullRequestCommentComposerProps {
	inputId: string
	label: string
	submitLabel: string
	pendingLabel: string
	isPending: boolean
	onSubmit: (body: string) => void
	defaultValue?: string
	errorMessage?: string
	onCancel?: () => void
	placeholder?: string
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
	errorMessage,
	onCancel,
	placeholder,
	shouldFocusOnMount,
}: Readonly<PullRequestCommentComposerProps>) {
	const [body, setBody] = useState(defaultValue ?? '')
	const isEmpty = body.trim().length === 0

	function focusOnMount(node: HTMLTextAreaElement | null) {
		if (node && shouldFocusOnMount) node.focus()
	}

	const handleSubmit: ComponentProps<'form'>['onSubmit'] = event => {
		event.preventDefault()
		if (isEmpty || isPending) return

		onSubmit(body.trim())
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
				placeholder={placeholder}
				ref={focusOnMount}
				value={body}
			/>
			{errorMessage && (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button disabled={isEmpty || isPending} size="sm" type="submit">
					{isPending ? pendingLabel : submitLabel}
				</Button>
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
