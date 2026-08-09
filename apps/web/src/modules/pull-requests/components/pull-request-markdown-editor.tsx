import { Label } from '@repo/ui/components/label'
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from '@repo/ui/components/tabs'
import { useState } from 'react'
import { MarkdownContent } from '@/shared/components/markdown-content'

const BODY_MAX_LENGTH = 65_536

interface PullRequestMarkdownEditorProps {
	defaultValue?: string
	id: string
	label: string
	name: string
	placeholder?: string
}

/**
 * A description field that can be read the way it will be published.
 *
 * The preview goes through the same `MarkdownContent` every published body is
 * rendered by, so what is shown here is exactly what the pull request will show
 * — there is no second parser, and nothing gains a way to render raw HTML by
 * being previewed.
 *
 * The textarea stays mounted behind the preview panel. It is the field the
 * surrounding form submits, and a description that was typed and then previewed
 * would otherwise be sent empty.
 */
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
			<Tabs className="gap-0" defaultValue="write">
				<TabsList aria-label="Description mode">
					<TabsTrigger value="write">Write</TabsTrigger>
					<TabsTrigger value="preview">Preview</TabsTrigger>
				</TabsList>
				<TabsContent keepMounted value="write">
					<textarea
						className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-hidden placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
						id={id}
						maxLength={BODY_MAX_LENGTH}
						name={name}
						onChange={event => setBody(event.target.value)}
						placeholder={placeholder}
						value={body}
					/>
				</TabsContent>
				<TabsContent value="preview">
					{body.trim() ? (
						<MarkdownContent className="min-h-32 rounded-md border border-input px-3 py-2">
							{body}
						</MarkdownContent>
					) : (
						<p className="min-h-32 rounded-md border border-input px-3 py-2 text-muted-foreground text-sm">
							Nothing to preview yet.
						</p>
					)}
				</TabsContent>
			</Tabs>
		</div>
	)
}
