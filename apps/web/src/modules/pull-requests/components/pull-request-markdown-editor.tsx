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

// The textarea stays mounted behind the preview panel: it is the field the
// surrounding form submits, and unmounting it would submit an empty body.
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
