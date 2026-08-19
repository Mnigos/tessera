import { Button } from '@repo/ui/components/button'
import { Label } from '@repo/ui/components/label'
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@repo/ui/components/tabs'
import { cn } from '@repo/ui/utils'
import { Bold, Code, Italic, Link2, List, type LucideIcon } from 'lucide-react'
import { type KeyboardEventHandler, useRef, useState } from 'react'
import { MarkdownContent } from '@/shared/components/markdown-content'
import { submitPullRequestComposerOnShortcut } from '../helpers/pull-request-composer-shortcut'
import {
	applyPullRequestMarkdownFormat,
	type PullRequestMarkdownFormat,
} from '../helpers/pull-request-markdown-format'

const BODY_MAX_LENGTH = 65_536

const MARKDOWN_TOOLBAR_ACTIONS = [
	{ format: 'bold', icon: Bold, label: 'Bold' },
	{ format: 'italic', icon: Italic, label: 'Italic' },
	{ format: 'code', icon: Code, label: 'Code' },
	{ format: 'link', icon: Link2, label: 'Link' },
	{ format: 'list', icon: List, label: 'Bulleted list' },
] as const satisfies readonly {
	format: PullRequestMarkdownFormat
	icon: LucideIcon
	label: string
}[]

const PULL_REQUEST_TEXTAREA_CLASSES =
	'w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/55'

interface PullRequestMarkdownFieldProps {
	id: string
	value: string
	onValueChange: (value: string) => void
	modeLabel: string
	name?: string
	placeholder?: string
	textareaClassName?: string
	shouldFocusOnMount?: boolean
	onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
}

/**
 * The one markdown writing surface in the product. The textarea stays mounted
 * behind the preview panel: it is the field the surrounding form submits.
 */
export function PullRequestMarkdownField({
	id,
	value,
	onValueChange,
	modeLabel,
	name,
	placeholder,
	textareaClassName,
	shouldFocusOnMount,
	onKeyDown = submitPullRequestComposerOnShortcut,
}: Readonly<PullRequestMarkdownFieldProps>) {
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	function registerTextarea(node: HTMLTextAreaElement | null) {
		textareaRef.current = node

		if (node && shouldFocusOnMount) node.focus()
	}

	function handleFormat(format: PullRequestMarkdownFormat) {
		const textarea = textareaRef.current

		if (!textarea) return

		onValueChange(applyPullRequestMarkdownFormat(textarea, format))
	}

	return (
		<Tabs className="gap-0" defaultValue="write">
			<div className="flex items-center justify-between gap-2">
				<TabsList aria-label={modeLabel} className="h-8">
					<TabsTrigger className="px-3 py-1 text-xs" value="write">
						Write
					</TabsTrigger>
					<TabsTrigger className="px-3 py-1 text-xs" value="preview">
						Preview
					</TabsTrigger>
				</TabsList>
				<div className="flex items-center gap-0.5">
					{MARKDOWN_TOOLBAR_ACTIONS.map(action => (
						<Button
							aria-label={action.label}
							className="size-6 text-muted-foreground"
							key={action.format}
							onClick={() => handleFormat(action.format)}
							size="icon"
							type="button"
							variant="ghost"
						>
							<action.icon aria-hidden className="size-3.5" />
						</Button>
					))}
				</div>
			</div>
			<TabsContent keepMounted value="write">
				<textarea
					className={cn(PULL_REQUEST_TEXTAREA_CLASSES, textareaClassName)}
					id={id}
					maxLength={BODY_MAX_LENGTH}
					name={name}
					onChange={event => onValueChange(event.target.value)}
					onKeyDown={onKeyDown}
					placeholder={placeholder}
					ref={registerTextarea}
					value={value}
				/>
			</TabsContent>
			<TabsContent value="preview">
				{value.trim() ? (
					<MarkdownContent
						className={cn(
							'rounded-md border border-input px-3 py-2',
							textareaClassName
						)}
					>
						{value}
					</MarkdownContent>
				) : (
					<p
						className={cn(
							'rounded-md border border-input px-3 py-2 text-muted-foreground text-sm',
							textareaClassName
						)}
					>
						Nothing to preview yet.
					</p>
				)}
			</TabsContent>
		</Tabs>
	)
}

interface PullRequestMarkdownEditorProps {
	defaultValue?: string
	id: string
	label: string
	name: string
	placeholder?: string
}

export function PullRequestMarkdownEditor({
	defaultValue = '',
	id,
	label,
	name,
	placeholder,
}: Readonly<PullRequestMarkdownEditorProps>) {
	const [body, setBody] = useState(defaultValue)

	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor={id}>{label}</Label>
			<PullRequestMarkdownField
				id={id}
				modeLabel={`${label} mode`}
				name={name}
				onValueChange={setBody}
				placeholder={placeholder}
				textareaClassName="min-h-32"
				value={body}
			/>
		</div>
	)
}
